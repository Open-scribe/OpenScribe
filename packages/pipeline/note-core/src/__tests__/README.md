# OpenScribe Test Suite

This directory contains comprehensive tests for the clinical note generation pipeline.

## Test Structure

### LLM Integration Tests (`packages/llm/src/__tests__/`)

**llm-integration.test.ts (6 tests)**

Tests for the Anthropic API integration layer:

- **API Key Validation**: Ensures proper error handling when API keys are missing
- **Parameter Validation**: Verifies required parameters are enforced
- **Simple Prompts**: Tests basic text generation
- **Structured Output**: Validates JSON schema enforcement via tool calling
- **Streaming (skipped)**: Placeholder for future streaming implementation
- **Error Handling**: Ensures graceful handling of API errors

**Key Features:**
- Skips live API tests when `ANTHROPIC_API_KEY` is not set (CI-friendly)
- Uses cheaper models (claude-3-haiku) for cost-effective testing
- Validates both request construction and response parsing

### Note Generator Tests (`packages/pipeline/note-core/src/__tests__/`)

**clinical-note.test.ts (19 tests)**

Tests clinical note data models, parsing, and serialization:

- **JSON Parsing (9 tests)**: Markdown fence handling, Unicode, special characters, malformed JSON, null/undefined, type validation
- **Serialization (5 tests)**: JSON formatting, field ordering, empty fields, type coercion
- **Formatting (3 tests)**: Human-readable note structure, section validation
- **Round-trip (2 tests)**: Data integrity through serialize → parse → serialize

**note-generator.test.ts (6 tests)**

Tests end-to-end clinical note generation:

- **Empty Input Handling**: Verifies empty transcripts return empty notes
- **JSON Structure Validation**: Ensures all required fields are present and correctly typed
- **Content Generation**: Validates appropriate content extraction from transcripts
- **Conservative Documentation**: Ensures system doesn't invent information
- **Markdown Fence Handling**: Tests parsing of both raw JSON and markdown-wrapped responses
- **Error Resilience**: Validates handling of malformed data, missing fields, wrong types
- **Prompt Versioning**: Ensures versioned prompt system is properly integrated
- **Schema Consistency**: Validates prompt schema matches TypeScript interface

**Key Features:**
- Flexible to implementation changes (doesn't hardcode prompts)
- Robust error detection (catches API incompatibilities, parsing failures)
- Tests both happy path and edge cases
- Validates data integrity throughout the pipeline

## Running Tests

### All Tests (31 total)
```bash
pnpm test
```

### LLM Tests Only
```bash
pnpm test:llm
```

### Note Generation Tests Only
```bash
pnpm test:note
```

### Audio Pipeline Tests
```bash
pnpm test:audio
```

## Environment Setup

For live API tests, set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key"
```

Tests will automatically skip live API calls if the key is not set, making them safe to run in CI environments without secrets.

## Test Philosophy

These tests are designed to be:

1. **Flexible**: Don't hardcode implementation details that may change
2. **Robust**: Catch critical errors like API incompatibilities, parsing failures, schema violations
3. **Fast**: Use efficient models and skip expensive operations when possible
4. **CI-Friendly**: Gracefully handle missing secrets and environment differences
5. **Comprehensive**: Cover happy paths, edge cases, and error conditions

## Adding New Tests

When adding tests:

1. **Place tests in `__tests__` directories** alongside the code they test
2. **Use descriptive test names** that explain what is being validated
3. **Skip live API tests** when credentials are missing (`if (!process.env.ANTHROPIC_API_KEY) return`)
4. **Test error conditions** not just happy paths
5. **Validate data structure** not just that code runs
6. **Use assertions** that are resilient to minor implementation changes

## Test Coverage

Key areas covered:

- ✅ API integration and authentication
- ✅ Request parameter validation
- ✅ Response parsing (including edge cases)
- ✅ JSON schema enforcement
- ✅ Error handling and recovery
- ✅ Data structure validation
- ✅ Prompt versioning system
- ✅ Type safety and schema consistency

## Known Limitations

- Live API tests require `ANTHROPIC_API_KEY` to be set
- Some tests may incur small API costs (using cheapest models to minimize)
- Tests that validate actual content generation may be sensitive to model changes
