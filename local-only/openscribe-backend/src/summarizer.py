try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    ollama = None
    OLLAMA_AVAILABLE = False
import json
import logging
import subprocess
import time
import os
from typing import Optional, Dict, Any
from .models import MeetingTranscript, ActionItem, Decision
from . import ollama_manager

logger = logging.getLogger(__name__)

# Keep local template definitions aligned with hosted templates.
DEFAULT_CLINICAL_TEMPLATE = """# History and Physical

## Chief Complaint
{{chief_complaint}}

## History of Present Illness
{{hpi}}

## Review of Systems
{{ros}}

## Past Medical History
{{pmh}}

## Medications
{{medications}}
"""

SOAP_CLINICAL_TEMPLATE = """# SOAP Note

## Subjective
### Chief Complaint
{{chief_complaint}}

### History of Present Illness
{{hpi}}

### Review of Systems
{{ros}}

## Objective
### Physical Examination
{{physical_exam}}

## Assessment
{{assessment}}

## Plan
{{plan}}
"""


class OllamaSummarizer:
    def __init__(self, model_name: Optional[str] = None):
        """
        Initialize the Ollama summarizer with automatic service management.

        Args:
            model_name: Name of the Ollama model to use. If None, loads from config.
        """
        if not OLLAMA_AVAILABLE:
            raise ImportError("Ollama is not installed. Please install ollama-python.")

        # Load model from config if not specified
        if model_name is None:
            try:
                from .config import get_config
                config = get_config()
                model_name = config.get_model()
                logger.info(f"Using configured model: {model_name}")
            except Exception as e:
                logger.warning(f"Failed to load model from config: {e}, using default")
                model_name = "llama3.2:3b"  # Default model

        self.model_name = model_name
        self.client = None
        self.ollama_process = None
        self._chat_options = {
            "temperature": float(os.getenv("OPENSCRIBE_OLLAMA_TEMPERATURE", "0.1")),
            "top_p": float(os.getenv("OPENSCRIBE_OLLAMA_TOP_P", "0.9")),
            "num_predict": int(os.getenv("OPENSCRIBE_OLLAMA_NUM_PREDICT", "260")),
        }
        self._keep_alive = os.getenv("OPENSCRIBE_OLLAMA_KEEP_ALIVE", "30m")

        # Ensure Ollama is ready before initializing client
        self._ensure_ollama_ready()
        self.client = ollama.Client()
        self._warmup_model()
    
    def _is_ollama_running(self) -> bool:
        """Check if Ollama service is running."""
        return ollama_manager.is_ollama_running()
    
    def _find_ollama_path(self) -> Optional[str]:
        """Find the Ollama executable path (bundled or system)."""
        ollama_path = ollama_manager.get_ollama_binary()
        if ollama_path:
            return str(ollama_path)
        logger.error("Ollama executable not found")
        return None
    
    def _start_ollama_service(self) -> bool:
        """Start the Ollama service if not running."""
        logger.info("Starting Ollama service...")
        return ollama_manager.start_ollama_server(wait=True, timeout=30)
    
    def _repair_json(self, json_text: str) -> Optional[str]:
        """
        Attempt to repair common JSON formatting issues.
        
        Args:
            json_text: The malformed JSON string
            
        Returns:
            Repaired JSON string or None if repair fails
        """
        try:
            logger.info("Attempting JSON repair...")
            repaired = json_text
            
            # Common repair patterns
            repairs = [
                # Fix unquoted strings in arrays (the original issue)
                (r'(\[|\,)\s*([^"\[\]{},:]+?)\s*(\]|\,)', r'\1 "\2" \3'),
                # Fix trailing commas
                (r',\s*}', '}'),
                (r',\s*]', ']'),
                # Fix missing quotes around object keys
                (r'(\{|\,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'\1 "\2":'),
                # Fix single quotes to double quotes
                (r"'([^']*)'", r'"\1"'),
            ]
            
            for pattern, replacement in repairs:
                import re
                old_repaired = repaired
                repaired = re.sub(pattern, replacement, repaired)
                if old_repaired != repaired:
                    logger.info(f"Applied repair: {pattern}")
            
            # Test if repaired JSON is valid
            json.loads(repaired)
            logger.info("JSON repair successful")
            return repaired
            
        except Exception as e:
            logger.error(f"JSON repair failed: {e}")
            return None
    
    def _create_enhanced_fallback(self, malformed_response: str, transcript: str, duration_minutes: int) -> MeetingTranscript:
        """
        Create an enhanced fallback summary by extracting whatever data we can.
        
        Args:
            malformed_response: The malformed JSON response from Ollama
            transcript: Original transcript
            duration_minutes: Meeting duration
            
        Returns:
            MeetingTranscript with extracted data
        """
        logger.info("Creating enhanced fallback summary...")
        
        # Try to extract useful information from malformed response
        overview = "Meeting transcript was processed but JSON parsing failed."
        participants = []
        key_points = []
        
        try:
            # Extract overview if present
            if '"overview"' in malformed_response:
                import re
                overview_match = re.search(r'"overview":\s*"([^"]*)"', malformed_response)
                if overview_match:
                    overview = overview_match.group(1)
                    logger.info("Extracted overview from malformed response")
            
            # Extract participants if present
            if '"participants"' in malformed_response:
                # Try to find participant names between quotes
                import re
                participants_section = re.search(r'"participants":\s*\[(.*?)\]', malformed_response, re.DOTALL)
                if participants_section:
                    # Extract quoted strings
                    quoted_names = re.findall(r'"([^"]+)"', participants_section.group(1))
                    participants = quoted_names
                    logger.info(f"Extracted {len(participants)} participants from malformed response")
            
            # Extract key points if present
            if '"key_points"' in malformed_response:
                import re
                key_points_section = re.search(r'"key_points":\s*\[(.*?)\]', malformed_response, re.DOTALL)
                if key_points_section:
                    # Extract quoted strings
                    quoted_points = re.findall(r'"([^"]+)"', key_points_section.group(1))
                    key_points = quoted_points
                    logger.info(f"Extracted {len(key_points)} key points from malformed response")
            
        except Exception as e:
            logger.warning(f"Failed to extract data from malformed response: {e}")
        
        # Create fallback summary with extracted data
        fallback_summary = MeetingTranscript(
            duration=f"{duration_minutes} minutes",
            overview=overview,
            participants=participants,
            next_steps=[],  # Create empty action items since parsing failed
            key_points=[],  # Create empty key points since parsing failed  
            transcript=transcript
        )
        
        # Add key points
        for point in key_points:
            from .models import Decision
            fallback_summary.key_points.append(Decision(
                decision=point,
                assignee='',
                context='Extracted from partially parsed response'
            ))
        
        logger.info("Created enhanced fallback summary with extracted data")
        return fallback_summary
    
    def _ensure_model_available(self) -> bool:
        """Ensure the required model is downloaded and available (uses HTTP API)."""
        t0 = time.perf_counter()
        try:
            # Use the ollama Python client (HTTP API) instead of the binary
            # This avoids SIP/DYLD issues on macOS when running from a packaged app
            response = ollama.list()
            models = getattr(response, 'models', []) or []
            model_names = [getattr(m, 'model', '') for m in models]

            if self.model_name in model_names:
                logger.info(f"Model {self.model_name} is already available")
                return True

            # Prefer an already-installed fallback before attempting network pulls.
            fallback_models = ["llama3.2:3b", "gemma3:4b"]
            for fallback in fallback_models:
                if fallback in model_names:
                    logger.info(f"Using already-installed fallback model: {fallback}")
                    self.model_name = fallback
                    return True

            # Model not found, try to pull it
            logger.info(f"Downloading model {self.model_name}...")
            try:
                ollama.pull(self.model_name)
                logger.info(f"Successfully downloaded model {self.model_name}")
                return True
            except Exception as e:
                logger.error(f"Failed to download model {self.model_name}: {e}")

            for fallback in fallback_models:
                logger.info(f"Trying fallback model: {fallback}")
                try:
                    ollama.pull(fallback)
                    logger.info(f"Successfully downloaded fallback model {fallback}")
                    self.model_name = fallback
                    return True
                except Exception:
                    continue

            return False

        except Exception as e:
            logger.error(f"Error ensuring model availability: {e}")
            return False
        finally:
            logger.info("Model availability check completed in %.2fs", time.perf_counter() - t0)
    
    def _ensure_ollama_ready(self) -> bool:
        """Ensure Ollama service is running and model is available."""
        logger.info("Checking Ollama service...")
        t0 = time.perf_counter()
        
        # Step 1: Check if Ollama is running
        if not self._is_ollama_running():
            if not self._start_ollama_service():
                raise Exception("Failed to start Ollama service")
        else:
            logger.info("Ollama service is already running")
        
        # Step 2: Ensure model is available
        if not self._ensure_model_available():
            raise Exception(f"Failed to ensure model {self.model_name} is available")

        logger.info(f"Ollama ready with model {self.model_name} (%.2fs)", time.perf_counter() - t0)
        return True

    def _warmup_model(self) -> None:
        """Issue a tiny request so first real note generation is faster."""
        if os.getenv("OPENSCRIBE_OLLAMA_WARMUP", "0").lower() not in {"1", "true", "yes", "on"}:
            return
        try:
            t0 = time.perf_counter()
            self.client.chat(
                model=self.model_name,
                messages=[{"role": "user", "content": "Reply with OK."}],
                options={"num_predict": 2, "temperature": 0},
                keep_alive=self._keep_alive,
            )
            logger.info("Ollama model warmup completed in %.2fs", time.perf_counter() - t0)
        except Exception as e:
            logger.warning("Ollama warmup skipped due to error: %s", e)
        
    def _create_permissive_prompt(self, transcript: str) -> str:
        """
        Create an enhanced prompt with discussion_areas and improved extraction.
        Uses more examples in schema to permit more detailed summaries.
        """
        return f"""You are a helpful meeting assistant. Summarise this meeting transcript into participants, discussion areas, key points and any next steps mentioned. Only base your summary on what was explicitly discussed in the transcript.

IMPORTANT: Do not infer or assume information that wasn't directly mentioned.

Include a brief overview so someone can quickly understand what happened in the meeting, who were the participants, what areas/topics were discussed, what were the key points, and what are the next steps if any were mentioned.

CRITICAL JSON FORMATTING RULES:
1. ALL strings must be enclosed in double quotes "like this"
2. Use null (not "null") for empty values
3. NO trailing commas anywhere
4. NO comments or extra text outside the JSON
5. ALL array elements must be properly quoted strings
6. If no participants, discussion areas, key points, or next steps are mentioned, return an empty array [] for that field.

IMPORTANT - VARIABLE NUMBER OF ITEMS:
- Discussion areas: Include as many as needed to organize the topics (1-2 for short meetings, 4-5 for complex discussions)
- Key points: Extract as many as were actually discussed (2-3 for short meetings, 6-8 for detailed discussions)
- Next steps: Include only action items that were clearly mentioned (could be 1, could be 6+)
- The examples below are illustrative - do not feel obligated to match the exact number shown

CORRECT FORMAT EXAMPLE:
{{
  "participants": ["John Smith", "Sarah Wilson"],
  "key_points": ["Budget discussion", "Timeline review"]
}}

INCORRECT FORMAT (DO NOT DO THIS):
{{
  "participants": ["John", no other participants mentioned],
  "key_points": ["Budget", timeline,]
}}

TRANSCRIPT:
{transcript}

Return ONLY the response in this exact JSON format:
{{
  "overview": "Brief overview of what happened in the meeting",
  "participants": [""],
  "discussion_areas": [
    {{
      "title": "First main topic discussed",
      "analysis": "Short paragraph about what was discussed in this topic"
    }},
    {{
      "title": "Second main topic discussed",
      "analysis": "Short paragraph about what was discussed in this topic"
    }},
    {{
      "title": "Third main topic discussed",
      "analysis": "Short paragraph about what was discussed in this topic"
    }}
  ],
  "key_points": [
    "First important point or topic discussed",
    "Second key point from the meeting",
    "Third key point from the meeting",
    "Fourth key point from the meeting",
    "Fifth key point from the meeting"
  ],
  "next_steps": [
    {{
      "description": "First next step or action item as explicitly mentioned",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }},
    {{
      "description": "Second next step or action item",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }},
    {{
      "description": "Third next step or action item",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }},
    {{
      "description": "Fourth next step or action item",
      "assignee": "Person responsible or null if unclear",
      "deadline": "Deadline mentioned or null"
    }}
  ]
}}"""

    def _template_name_from_note_type(self, note_type: Optional[str]) -> str:
        if not note_type:
            return "default"
        normalized = note_type.strip().lower()
        if normalized in {"soap", "problem_visit", "problem-visit", "problem visit"}:
            return "soap"
        return "default"

    def _template_from_note_type(self, note_type: Optional[str]) -> str:
        template_name = self._template_name_from_note_type(note_type)
        return SOAP_CLINICAL_TEMPLATE if template_name == "soap" else DEFAULT_CLINICAL_TEMPLATE

    def _create_clinical_note_prompt(self, transcript: str, note_type: Optional[str]) -> str:
        template = self._template_from_note_type(note_type)
        template_name = self._template_name_from_note_type(note_type)
        return f"""You are an expert clinical documentation assistant with deep medical knowledge. Convert the transcript into a clinical note.

CORE PRINCIPLES:
- Accuracy: Only document information explicitly stated in the transcript
- Precision: Use appropriate medical terminology while maintaining clarity
- Completeness: Extract all relevant clinical information for each section
- Conservatism: Leave sections empty if no relevant information exists

OUTPUT FORMAT:
Return markdown following this exact template structure:

{template}

TEMPLATE INSTRUCTIONS:
- Maintain all headings exactly as shown
- Replace placeholders with real content from transcript
- Leave empty sections empty (do not write "Not discussed" or similar)
- Do not wrap output in code fences
- Do not add extra headings or explanatory text
- If a section has no explicit support in transcript/context, omit content entirely for that section

ACTIVE TEMPLATE: {template_name}

TRANSCRIPT:
{transcript}
"""

    def _create_history_physical_json_prompt(self, transcript: str) -> str:
        return f"""You are a clinical documentation assistant.

Extract ONLY information explicitly stated in the transcript. Do not infer, assume, or add missing details.

Return ONLY valid JSON with these exact keys:
- chief_complaint: string or null
- hpi: string or null
- ros: array of strings (bullet-ready) or []
- pmh: string or null
- medications: array of strings (include doses only if explicitly stated) or []

STRICT RULES:
- If a section is not explicitly supported by the transcript, return null (or [] for arrays).
- No extra keys.
- No markdown.

TRANSCRIPT:
{transcript}
"""

    def _extract_json_object(self, text: str) -> Dict[str, Any]:
        if not text:
            return {}
        raw = text.strip()
        if raw.startswith("```json"):
            raw = raw.replace("```json", "").replace("```", "").strip()
        elif raw.startswith("```"):
            raw = raw.replace("```", "").strip()
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            pass
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(raw[start : end + 1])
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    def _render_history_physical_note(self, fields: Dict[str, Any]) -> str:
        def clean_text(value: Any) -> str:
            if value is None:
                return ""
            if isinstance(value, str):
                return value.strip()
            return str(value).strip()

        def clean_list(value: Any) -> list[str]:
            if not isinstance(value, list):
                return []
            out = []
            for item in value:
                item_txt = clean_text(item)
                if item_txt:
                    out.append(item_txt)
            return out

        chief_complaint = clean_text(fields.get("chief_complaint"))
        hpi = clean_text(fields.get("hpi"))
        ros = clean_list(fields.get("ros"))
        pmh = clean_text(fields.get("pmh"))
        medications = clean_list(fields.get("medications"))

        sections: list[str] = []
        if chief_complaint:
            sections.append(f"Chief Complaint:\n{chief_complaint}")
        if hpi:
            sections.append(f"History of Present Illness:\n{hpi}")
        if ros:
            ros_bullets = "\n".join(f"- {item}" for item in ros)
            sections.append(f"Review of Systems:\n{ros_bullets}")
        if pmh:
            sections.append(f"Past Medical History:\n{pmh}")
        if medications:
            med_bullets = "\n".join(f"- {item}" for item in medications)
            sections.append(f"Medications:\n{med_bullets}")

        return "\n\n".join(sections)

    def generate_clinical_note(self, transcript: str, note_type: Optional[str] = None) -> str:
        """
        Generate a markdown clinical note from transcript using hosted-equivalent templates.
        Returns template skeleton if generation fails.
        """
        template = self._template_from_note_type(note_type)
        if not transcript or transcript.strip() == "":
            # Return an empty template with placeholders removed.
            return template.replace("{{chief_complaint}}", "") \
                .replace("{{hpi}}", "") \
                .replace("{{ros}}", "") \
                .replace("{{pmh}}", "") \
                .replace("{{medications}}", "") \
                .replace("{{physical_exam}}", "") \
                .replace("{{assessment}}", "") \
                .replace("{{plan}}", "")
        normalized_transcript = transcript.strip().lower()
        if normalized_transcript in {"none", "no speech detected in audio", "audio file too small or empty"}:
            return ""

        try:
            template_name = self._template_name_from_note_type(note_type)
            is_history_physical = template_name == "default"
            prompt = (
                self._create_history_physical_json_prompt(transcript)
                if is_history_physical
                else self._create_clinical_note_prompt(transcript, note_type)
            )
            llm_t0 = time.perf_counter()
            max_retries = 3
            ollama_response = None
            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        logger.info("Clinical note retry %s/%s", attempt + 1, max_retries)
                        self._ensure_ollama_ready()
                        self.client = ollama.Client()
                        time.sleep(1)
                    ollama_response = self.client.chat(
                        model=self.model_name,
                        messages=[{"role": "user", "content": prompt}],
                        options={
                            **self._chat_options,
                            "num_predict": min(self._chat_options.get("num_predict", 260), 220)
                            if is_history_physical
                            else self._chat_options.get("num_predict", 260),
                            "timeout": 1800,
                        },
                        format="json" if is_history_physical else None,
                        keep_alive=self._keep_alive,
                    )
                    break
                except Exception as e:
                    logger.error("Clinical note attempt %s failed: %s", attempt + 1, e)
                    if attempt == max_retries - 1:
                        raise
            llm_elapsed = time.perf_counter() - llm_t0
            logger.info("Clinical note LLM call completed in %.2fs", llm_elapsed)
            eval_count = ollama_response.get("eval_count")
            eval_duration = ollama_response.get("eval_duration")
            if eval_count and eval_duration:
                tps = eval_count / (eval_duration / 1_000_000_000)
                logger.info("Clinical note generation speed: %.1f tok/s (%s tokens)", tps, eval_count)
            response_text = ollama_response["message"]["content"].strip()
            if is_history_physical:
                parsed = self._extract_json_object(response_text)
                return self._render_history_physical_note(parsed)
            if response_text.startswith("```markdown"):
                response_text = response_text.replace("```markdown", "").replace("```", "").strip()
            elif response_text.startswith("```"):
                response_text = response_text.replace("```", "").strip()
            return response_text
        except Exception as e:
            logger.error(f"Clinical note generation failed, returning empty template: {e}")
            return template.replace("{{chief_complaint}}", "") \
                .replace("{{hpi}}", "") \
                .replace("{{ros}}", "") \
                .replace("{{pmh}}", "") \
                .replace("{{medications}}", "") \
                .replace("{{physical_exam}}", "") \
                .replace("{{assessment}}", "") \
                .replace("{{plan}}", "")

    def summarize_transcript(self, transcript: str, duration_minutes: int) -> Optional[MeetingTranscript]:
        """
        Summarize a meeting transcript using Ollama.
        
        Args:
            transcript: The meeting transcript text
            duration_minutes: Duration of the meeting in minutes
            
        Returns:
            MeetingTranscript object or None if summarization failed
        """
        try:
            # Handle empty or None transcripts
            if not transcript or transcript.strip() == "" or transcript.lower().strip() == "none":
                logger.warning("Empty or None transcript provided, returning placeholder summary")
                return MeetingTranscript(
                    overview="No transcript was generated for this recording. This may be due to poor audio quality, silence throughout the recording, or technical issues with the speech recognition system.",
                    participants=[],
                    action_items=[],
                    decisions=[],
                    duration_minutes=duration_minutes
                )
            
            prompt = self._create_permissive_prompt(transcript)
            logger.info(f"Sending transcript to Ollama model: {self.model_name}")
            logger.info(f"Transcript length: {len(transcript)} characters")

            # Calculate dynamic timeout based on transcript length
            # Base 30 min + 10 min per 10k chars, capped at 2 hours
            base_timeout = 1800  # 30 minutes
            extra_timeout = (len(transcript) // 10000) * 600  # 10 min per 10k chars
            timeout_seconds = min(base_timeout + extra_timeout, 7200)  # Cap at 2 hours
            logger.info(f"Using timeout: {timeout_seconds} seconds ({timeout_seconds // 60} minutes)")
            
            # Retry logic for Ollama API calls
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        logger.info(f"Retry attempt {attempt + 1}/{max_retries}")
                        # Ensure Ollama is still ready on retries
                        self._ensure_ollama_ready()
                        # Recreate client connection
                        self.client = ollama.Client()
                        
                    ollama_response = self.client.chat(
                        model=self.model_name,
                        messages=[
                            {
                                'role': 'user',
                                'content': prompt
                            }
                        ],
                        options={
                            'timeout': timeout_seconds  # Dynamic timeout based on transcript length
                        }
                    )
                    break  # Success, exit retry loop
                    
                except Exception as e:
                    logger.error(f"Ollama API attempt {attempt + 1} failed: {e}")
                    if attempt == max_retries - 1:
                        raise  # Last attempt, re-raise the exception
                    else:
                        logger.info("Waiting 5 seconds before retry...")
                        time.sleep(5)
            
            response_text = ollama_response['message']['content'].strip()
            logger.info("Received response from Ollama")
            logger.info(f"Response length: {len(response_text)} characters")
            logger.info(f"Response preview: {response_text[:200]}...")
            
            # Try to parse JSON response with repair functionality
            try:
                # Remove any markdown formatting
                if response_text.startswith('```json'):
                    response_text = response_text.replace('```json', '').replace('```', '').strip()
                elif response_text.startswith('```'):
                    response_text = response_text.replace('```', '').strip()
                
                # Handle preamble text like "Here is the extracted information in JSON format:"
                if '{' in response_text and '}' in response_text:
                    # Find the first { and last } to extract just the JSON
                    json_start = response_text.find('{')
                    json_end = response_text.rfind('}') + 1
                    response_text = response_text[json_start:json_end].strip()
                
                # First attempt - try parsing as-is
                structured_data = json.loads(response_text)
                logger.info("Successfully parsed JSON response")
                
            except json.JSONDecodeError as e:
                logger.error(f"Ollama returned invalid JSON: {e}")
                logger.error(f"JSON parse error at position: {e.pos}")
                logger.error(f"Full Ollama response: {response_text}")
                logger.info("Attempting simple JSON repair for unquoted strings...")
                
                # Simple fix for unquoted strings in arrays (the actual issue we encountered)
                import re
                repaired_json = re.sub(r'(\[|\,)\s*([^"\[\]{},:]+?)\s*(\]|\,)', r'\1 "\2" \3', response_text)
                
                try:
                    structured_data = json.loads(repaired_json)
                    logger.info("Successfully parsed repaired JSON response")
                except json.JSONDecodeError:
                    logger.error("JSON repair failed, creating fallback summary")
                    
                    # Create simple fallback summary with original user-friendly message
                    fallback_summary = MeetingTranscript(
                        duration=f"{duration_minutes} minutes",
                        overview="Meeting transcript recorded but detailed analysis failed. Content appears to be in a non-English language or format not fully supported.",
                        participants=[],
                        next_steps=[],
                        key_points=[],
                        transcript=transcript
                    )
                    logger.info("Created fallback summary")
                    return fallback_summary
            
            # Create MeetingTranscript object
            try:
                # Parse next steps (formerly key_actions)
                actions = []
                for action_data in structured_data.get('next_steps', []):
                    actions.append(ActionItem(
                        description=action_data.get('description', ''),
                        assignee=action_data.get('assignee', '') or '',
                        deadline=action_data.get('deadline')
                    ))
                
                # Parse key points as decisions (keeping the same data structure for compatibility)
                decisions = []
                for point in structured_data.get('key_points', []):
                    if isinstance(point, str):
                        # Simple string format
                        decisions.append(Decision(
                            decision=point,
                            assignee='',
                            context=''
                        ))
                    elif isinstance(point, dict):
                        # Object format (fallback for complex key points)
                        decisions.append(Decision(
                            decision=point.get('point', ''),
                            assignee='',
                            context=point.get('context', '')
                        ))

                # Parse discussion areas (new field from permissive prompt)
                from .models import DiscussionArea
                discussion_areas = []
                for area_data in structured_data.get('discussion_areas', []):
                    if isinstance(area_data, dict):
                        discussion_areas.append(DiscussionArea(
                            title=area_data.get('title', ''),
                            analysis=area_data.get('analysis', '')
                        ))

                meeting_summary = MeetingTranscript(
                    duration=f"{duration_minutes} minutes",
                    overview=structured_data.get('overview', ''),
                    participants=structured_data.get('participants', []),
                    discussion_areas=discussion_areas,
                    next_steps=actions,
                    key_points=decisions,
                    transcript=transcript
                )
                
                logger.info("Successfully created MeetingTranscript object")
                return meeting_summary
                
            except Exception as e:
                logger.error(f"Error creating MeetingTranscript object: {e}")
                return None
                
        except Exception as e:
            logger.error(f"Ollama API call failed: {e}")
            logger.error(f"Model used: {self.model_name}")
            logger.error(f"Transcript length: {len(transcript)} characters")
            logger.error(f"Error type: {type(e).__name__}")
            if hasattr(e, 'response'):
                logger.error(f"HTTP response: {e.response}")
            return None
    
    def test_connection(self) -> bool:
        """
        Test connection to Ollama.
        
        Returns:
            True if connection is successful
        """
        try:
            models = self.client.list()
            available_models = [model.model for model in models.models]
            
            if self.model_name not in available_models:
                logger.warning(f"Model {self.model_name} not found. Available models: {available_models}")
                if available_models:
                    self.model_name = available_models[0]
                    logger.info(f"Using available model: {self.model_name}")
                else:
                    logger.error("No models available in Ollama")
                    return False
            
            # Test with a simple prompt
            test_response = self.client.chat(
                model=self.model_name,
                messages=[{'role': 'user', 'content': 'Hello'}]
            )
            
            logger.info("Ollama connection test successful")
            logger.debug(f"Test response: {test_response.get('message', {}).get('content', '')[:50]}...")
            return True
            
        except Exception as e:
            logger.error(f"Ollama connection test failed: {e}")
            return False
    
    def set_model(self, model_name: str) -> bool:
        """
        Change the Ollama model.
        
        Args:
            model_name: Name of the new model
            
        Returns:
            True if model is available and set successfully
        """
        try:
            models = self.client.list()
            available_models = [model.model for model in models.models]
            
            if model_name in available_models:
                self.model_name = model_name
                logger.info(f"Model changed to: {model_name}")
                return True
            else:
                logger.error(f"Model {model_name} not available. Available models: {available_models}")
                return False
                
        except Exception as e:
            logger.error(f"Error setting model: {e}")
            return False
    
    def cleanup(self):
        """Clean up Ollama process if we started it."""
        if self.ollama_process:
            try:
                self.ollama_process.terminate()
                self.ollama_process.wait(timeout=10)
                logger.info("Ollama service process terminated")
            except:
                try:
                    self.ollama_process.kill()
                    logger.info("Ollama service process killed")
                except:
                    pass
            self.ollama_process = None
    
    def __del__(self):
        """Cleanup when object is destroyed."""
        self.cleanup()

    def query_transcript(self, transcript: str, question: str) -> Optional[str]:
        """
        Query a transcript with a question using Ollama.

        Args:
            transcript: The meeting transcript text
            question: The question to ask about the transcript

        Returns:
            Answer string or None if query failed
        """
        try:
            if not transcript or transcript.strip() == "":
                return "No transcript available to query."

            if not question or question.strip() == "":
                return "Please provide a question."

            prompt = f"""Answer the following question based ONLY on the meeting transcript below.
If the information is not in the transcript, say "This isn't mentioned in the transcript."
Be concise and direct.

QUESTION: {question}

TRANSCRIPT:
{transcript}

ANSWER:"""

            logger.info(f"Querying transcript with question: {question[:50]}...")

            # Retry logic for Ollama API calls
            max_retries = 2
            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        logger.info(f"Retry attempt {attempt + 1}/{max_retries}")
                        self._ensure_ollama_ready()
                        self.client = ollama.Client()

                    ollama_response = self.client.chat(
                        model=self.model_name,
                        messages=[
                            {
                                'role': 'user',
                                'content': prompt
                            }
                        ],
                        options={
                            'timeout': 120  # 2 minute timeout for queries
                        }
                    )
                    break

                except Exception as e:
                    logger.error(f"Ollama API attempt {attempt + 1} failed: {e}")
                    if attempt == max_retries - 1:
                        raise
                    else:
                        logger.info("Waiting 2 seconds before retry...")
                        time.sleep(2)

            response_text = ollama_response['message']['content'].strip()
            logger.info(f"Query response received: {len(response_text)} characters")

            return response_text

        except Exception as e:
            logger.error(f"Query transcript failed: {e}")
            return None
