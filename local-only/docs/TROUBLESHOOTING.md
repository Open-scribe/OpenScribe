# Local-Only Troubleshooting

## MedASR model fails to load
- Ensure you installed `transformers` from Git (required for `lasr_ctc`).

```bash
. .venv-med/bin/activate
pip install --upgrade git+https://github.com/huggingface/transformers.git
```

## llama.cpp crashes with Metal errors
- On some M2 machines, Metal fails to allocate command queues.
- The local runner uses BLAS (CPU) by default; it is slower but stable.

## No output from llama-completion
- Ensure the GGUF exists:
  `./models/medgemma-1.5-4b-it-q4_k_m.gguf`
- Ensure the prompt file exists:
  `./build/medgemma-prompt.txt`

## Transcript quality is noisy
- CTC models can output duplicated syllables.
- Current script removes `<epsilon>` and compresses whitespace, but you can add
  a stronger post-processor if needed.

## Out of memory
- Use Q4 quantization (Q4_K_M). Higher precision may exceed RAM.
