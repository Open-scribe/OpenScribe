# Clinical Note Templates

This directory contains markdown templates for clinical note generation. Templates define the structure and formatting of notes produced by OpenScribe.

## Available Templates

### `default.md`
Standard clinical note format with six core sections:
- Chief Complaint
- History of Present Illness
- Review of Systems
- Physical Exam
- Assessment
- Plan

### `soap.md`
SOAP (Subjective/Objective/Assessment/Plan) note format, organizing sections hierarchically.

## Creating Custom Templates

### 1. Add Template to index.ts

Templates are defined as string constants in `index.ts`. To add a custom template:

```typescript
// In packages/llm/src/prompts/clinical-note/templates/index.ts

const MY_CUSTOM_TEMPLATE = `# My Custom Note

## Section One
{{content_here}}

## Section Two
{{more_content}}
`;

// Add to registry
const TEMPLATES: Record<string, string> = {
  default: DEFAULT_TEMPLATE,
  soap: SOAP_TEMPLATE,
  'my-custom': MY_CUSTOM_TEMPLATE, // Add your template here
};
```

### 2. (Optional) Create Reference .md File

For easier editing, create a `.md` file as a reference:

```markdown
# My Custom Note

## Section One
{{content_here}}

## Section Two
{{more_content}}
```

Then copy its content into `index.ts`.

### 3. Use in Note Generation

```typescript
import { createClinicalNoteText } from '@note-core';

const note = await createClinicalNoteText({
  transcript: 'Patient says...',
  patient_name: 'John Doe',
  visit_reason: 'Follow-up',
  template: 'my-custom'
});
```

## Template Syntax

### Headings
- `#` Level 1 - Document title
- `##` Level 2 - Main sections (parsed as separate sections)
- `###` Level 3+ - Subsections (kept within parent section)

### Placeholders
Use `{{placeholder_name}}` for instructional purposes, but the LLM will replace entire sections with extracted content from the transcript.

### Structure Guidelines
- Use level 2 headings (`##`) for sections you want extracted separately
- Keep consistent heading names for standard sections
- Add specialized sections for specialty-specific workflows
- Use markdown formatting (lists, bold, etc.) as needed

## Examples

### Minimal Template
```markdown
# Quick Note

## Chief Complaint
{{cc}}

## Assessment & Plan
{{ap}}
```

### Detailed SOAP Template
```markdown
# SOAP Note

## Subjective
### Chief Complaint
{{chief_complaint}}

### History of Present Illness
{{hpi}}

### Review of Systems
{{ros}}

## Objective
### Vital Signs
{{vitals}}

### Physical Examination
{{physical_exam}}

## Assessment
{{assessment}}

## Plan
{{plan}}
```

### Specialty Template (Pediatrics)
```markdown
# Pediatric Visit Note

## Reason for Visit
{{reason}}

## History
### Presenting Concern
{{concern}}

### Development
{{development}}

### Immunizations
{{immunizations}}

## Examination
### Growth Parameters
{{growth}}

### Physical Exam
{{exam}}

## Assessment
{{assessment}}

## Plan
### Anticipatory Guidance
{{guidance}}

### Follow-up
{{followup}}
```

## Template Best Practices

1. **Keep sections clear** - Use descriptive headings
2. **Standard sections first** - Put common sections (CC, HPI, etc.) before specialized ones
3. **Consistent naming** - Use standard medical terminology
4. **Logical flow** - Order sections chronologically or by clinical workflow
5. **Subsections sparingly** - Too many nested levels can be harder to parse

## Modifying Templates

Templates can be freely edited without code changes. The markdown parser extracts sections by heading level automatically.

Common modifications:
- Reorder sections for specialty workflows
- Add subsections for detailed documentation
- Remove sections not relevant to your practice
- Add specialty-specific sections (e.g., "Procedure Note", "Medication Reconciliation")

## Validation

The system validates that standard sections exist but allows flexible structure:
- Chief Complaint
- History of Present Illness
- Review of Systems
- Physical Exam
- Assessment
- Plan

If these sections are missing, a warning is logged but the note is still saved.

## Troubleshooting

**Problem:** Sections not being extracted correctly  
**Solution:** Ensure you're using level 2 headings (`##`) for main sections

**Problem:** Template not found  
**Solution:** Check that the filename matches the name passed to `loadTemplate()` and that you've added an export function in `index.ts`

**Problem:** LLM not following template structure  
**Solution:** Template is included in the system prompt as a guide. If the LLM consistently deviates, adjust the prompt instructions in `packages/llm/src/prompts/clinical-note/v1.ts`

## Contributing

To contribute a new template:
1. Fork the repository
2. Add your template `.md` file
3. Update `index.ts` with the loader
4. Test with various transcripts
5. Submit a pull request with:
   - Template description
   - Intended use case/specialty
   - Example output

## Further Reading

<!-- - [MIGRATION_MARKDOWN.md](../../../../../MIGRATION_MARKDOWN.md) - Full migration documentation -->
- [architecture.md](../../../../../../architecture.md) - System architecture overview
<!-- - [packages/pipeline/note-core/](../../../../pipeline/note-core/) - Note parsing and generation code -->
