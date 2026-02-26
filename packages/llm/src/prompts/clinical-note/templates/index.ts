/**
 * Clinical note markdown templates
 * 
 * Templates define the structure and formatting of clinical notes.
 * Contributors can modify these templates to customize note formats
 * without dealing with JSON schemas or code changes.
 */

/**
 * Default clinical note template
 */
const DEFAULT_TEMPLATE = `# History and Physical

## Chief Complaint
{{chief_complaint_in_patient_words}}

## History of Present Illness
{{hpi_narrative}}

## Review of Systems
{{ros_bullet_points}}

## Past Medical History
{{pmh}}

## Medications
{{medications_bullet_points}}
`;

/**
 * SOAP note template
 */
const SOAP_TEMPLATE = `# SOAP Note

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
`;

/**
 * Template registry
 */
const TEMPLATES: Record<string, string> = {
  default: DEFAULT_TEMPLATE,
  soap: SOAP_TEMPLATE,
};

/**
 * Get the default clinical note template
 */
export function getDefaultTemplate(): string {
  return DEFAULT_TEMPLATE;
}

/**
 * Get SOAP note template
 */
export function getSoapTemplate(): string {
  return SOAP_TEMPLATE;
}

/**
 * List available template names
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Get template by name with fallback to default
 */
export function getTemplate(name?: string): string {
  if (!name || name === 'default') {
    return DEFAULT_TEMPLATE;
  }
  
  const template = TEMPLATES[name];
  if (template) {
    return template;
  }
  
  console.warn(`Template "${name}" not found, using default`);
  return DEFAULT_TEMPLATE;
}
