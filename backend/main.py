import os
import asyncio
import httpx
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from bs4 import BeautifulSoup
from cerebras.cloud.sdk import Cerebras
from dotenv import load_dotenv
import logging
import time
from urllib.parse import urlparse

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware for Chrome extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development - restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Cerebras client
client = Cerebras(api_key=os.getenv("CEREBRAS_API_KEY"))

class SummarizeRequest(BaseModel):
    url: str

class SummarizeResponse(BaseModel):
    summary: str
    status: str
    error: str = None

# Multiple sets of headers to rotate through
SCRAPING_HEADERS_SETS = [
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
        "DNT": "1",
        "Sec-GPC": "1"
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1"
    },
    {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1"
    }
]

import random

async def scrape_stackoverflow_page(url: str) -> dict:
    """Scrape StackOverflow page with multiple fallback methods"""
    
    # Method 1: Try direct scraping with rotating headers
    for attempt in range(3):
        try:
            headers = random.choice(SCRAPING_HEADERS_SETS)
            logger.info(f"Attempt {attempt + 1}: Scraping URL: {url}")
            
            # Validate URL
            parsed_url = urlparse(url)
            if "stackoverflow.com" not in parsed_url.netloc:
                raise ValueError("URL must be from stackoverflow.com")
            
            # Add random delay to avoid rate limiting
            if attempt > 0:
                await asyncio.sleep(random.uniform(1, 3))
            
            # Create async httpx client with timeout and headers
            timeout = httpx.Timeout(45.0)  # Increased timeout
            
            async with httpx.AsyncClient(
                headers=headers,
                timeout=timeout,
                follow_redirects=True
            ) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    logger.info(f"Successfully fetched page on attempt {attempt + 1}")
                    return await parse_stackoverflow_content(response.text, url)
                elif response.status_code == 403:
                    logger.warning(f"403 Forbidden on attempt {attempt + 1}")
                    if attempt < 2:  # Try again with different headers
                        continue
                    else:
                        # Fallback to API method
                        logger.info("Trying StackExchange API fallback...")
                        return await scrape_with_api_fallback(url)
                else:
                    response.raise_for_status()
                    
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403 and attempt < 2:
                logger.warning(f"403 error on attempt {attempt + 1}, retrying...")
                continue
            elif e.response.status_code == 403:
                logger.info("All direct scraping attempts failed, trying API fallback...")
                return await scrape_with_api_fallback(url)
            else:
                raise e
        except Exception as e:
            if attempt < 2:
                logger.warning(f"Error on attempt {attempt + 1}: {e}")
                continue
            else:
                raise e
    
    # If we get here, all attempts failed
    raise HTTPException(status_code=503, detail="Unable to fetch page after multiple attempts")

async def scrape_with_api_fallback(url: str) -> dict:
    """Fallback method using StackExchange API"""
    try:
        # Extract question ID from URL
        question_id = None
        patterns = [
            r'/questions/(\d+)',
            r'/q/(\d+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                question_id = match.group(1)
                break
        
        if not question_id:
            raise ValueError("Could not extract question ID from URL")
        
        logger.info(f"Using StackExchange API for question ID: {question_id}")
        
        # Use StackExchange API
        api_url = f"https://api.stackexchange.com/2.3/questions/{question_id}"
        params = {
            'order': 'desc',
            'sort': 'activity',
            'site': 'stackoverflow',
            'filter': 'withbody'
        }
        
        headers = random.choice(SCRAPING_HEADERS_SETS)
        
        async with httpx.AsyncClient(headers=headers, timeout=30.0) as client:
            response = await client.get(api_url, params=params)
            response.raise_for_status()
            
            data = response.json()
            
            if not data.get('items'):
                raise ValueError("Question not found in API response")
            
            question = data['items'][0]
            
            # Get answers using API
            answers_url = f"https://api.stackexchange.com/2.3/questions/{question_id}/answers"
            answers_params = {
                'order': 'desc',
                'sort': 'votes',
                'site': 'stackoverflow',
                'filter': 'withbody',
                'pagesize': 3
            }
            
            answers_response = await client.get(answers_url, params=answers_params)
            answers_data = answers_response.json() if answers_response.status_code == 200 else {'items': []}
            
            # Convert API response to our format
            return {
                'title': question.get('title', 'No title'),
                'question_body': question.get('body', 'No question body'),
                'answers': [ans.get('body', '') for ans in answers_data.get('items', [])[:3]],
                'tags': question.get('tags', []),
                'url': url
            }
            
    except Exception as e:
        logger.error(f"API fallback failed: {e}")
        raise HTTPException(status_code=503, detail="Both direct scraping and API fallback failed")

async def parse_stackoverflow_content(html_content: str, url: str) -> dict:
    """Parse StackOverflow HTML content"""
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Extract title
        title_elem = soup.find('h1', class_='fs-headline1')
        if not title_elem:
            title_elem = soup.find('a', class_='question-hyperlink')
        if not title_elem:
            title_elem = soup.find('title')
        title = title_elem.get_text().strip() if title_elem else "No title found"
        
        # Extract question body
        question_body = ""
        question_elem = soup.find('div', class_='s-prose')
        if not question_elem:
            question_elem = soup.find('div', class_='post-text')
        if question_elem:
            question_body = question_elem.get_text().strip()
        
        # Extract top answers (limit to 3)
        answers = []
        answer_elems = soup.find_all('div', class_='answer')[:3]
        if not answer_elems:
            answer_elems = soup.find_all('div', class_='answercell')[:3]
        
        for answer_elem in answer_elems:
            answer_body = answer_elem.find('div', class_='s-prose')
            if not answer_body:
                answer_body = answer_elem.find('div', class_='post-text')
            if answer_body:
                answers.append(answer_body.get_text().strip())
        
        # Extract tags
        tags = []
        tag_elems = soup.find_all('a', class_='post-tag')
        for tag_elem in tag_elems:
            tags.append(tag_elem.get_text().strip())
        
        logger.info(f"Parsed: title={len(title)} chars, question={len(question_body)} chars, answers={len(answers)}")
        
        return {
            "title": title,
            "question_body": question_body,
            "answers": answers,
            "tags": tags,
            "url": url
        }
        
    except Exception as e:
        logger.error(f"Error parsing HTML content: {e}")
        raise HTTPException(status_code=500, detail=f"HTML parsing error: {str(e)}")

async def generate_summary(page_data: dict) -> str:
    """Generate summary using Cerebras LLM with proper error handling"""
    try:
        # Prepare the content for summarization
        content = f"""
        Title: {page_data['title']}
        
        Question: {page_data['question_body'][:2000]}  # Limit to avoid token limits
        
        Top Answers:
        {' '.join(page_data['answers'][:2])[:1500]}  # Limit answers
        
        Tags: {', '.join(page_data['tags'])}
        """
        
        system_prompt = """You are a technical summarizer. Create a concise HTML summary of this StackOverflow question. 
        Format your response as:
        <strong>🧵 TL;DR</strong>
        <ul>
        <li>Key point 1</li>
        <li>Key point 2</li>
        <li>Key point 3</li>
        </ul>
        Keep it under 150 words total. Focus on the problem, solution approach, and key technical details."""
        
        logger.info("Generating summary with Cerebras LLM")
        
        # Create completion with explicit non-streaming
        response = client.chat.completions.create(
            model="llama-4-scout-17b-16e-instruct",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content}
            ],
            max_tokens=300,
            temperature=0.3,
            stream=False  # Explicitly disable streaming
        )
        
        summary = response.choices[0].message.content.strip()
        logger.info(f"Generated summary: {len(summary)} characters")
        
        return summary
        
    except Exception as e:
        logger.error(f"Error generating summary: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

@app.post("/summarize", response_model=SummarizeResponse)
async def summarize_stackoverflow(request: SummarizeRequest):
    """Main endpoint to summarize StackOverflow questions"""
    start_time = time.time()
    
    try:
        logger.info(f"Received summarize request for: {request.url}")
        
        # Step 1: Scrape the page
        page_data = await scrape_stackoverflow_page(request.url)
        
        # Step 2: Generate summary
        summary = await generate_summary(page_data)
        
        elapsed_time = time.time() - start_time
        logger.info(f"Successfully generated summary in {elapsed_time:.2f} seconds")
        
        return SummarizeResponse(
            summary=summary,
            status="success"
        )
        
    except HTTPException as e:
        # Re-raise HTTP exceptions
        raise e
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return SummarizeResponse(
            summary="",
            status="error",
            error=f"Server error: {str(e)}"
        )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": time.time()}

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "StackOverflow Summarizer API", "status": "running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")