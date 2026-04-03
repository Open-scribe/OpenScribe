import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

from src import ollama_manager


class OllamaManagerTests(unittest.TestCase):
    def test_extract_model_names_handles_dict_and_object(self):
        dict_response = {
            "models": [
                {"name": "llama3.2:3b"},
                {"model": "qwen2.5:3b"},
            ]
        }
        names = ollama_manager._extract_model_names(dict_response)
        self.assertEqual(names, ["llama3.2:3b", "qwen2.5:3b"])

        class ModelObj:
            def __init__(self, model):
                self.model = model

        class ResponseObj:
            models = [ModelObj("phi3.5:mini")]

        names2 = ollama_manager._extract_model_names(ResponseObj())
        self.assertEqual(names2, ["phi3.5:mini"])

    def test_is_mlx_crash_detects_known_signature(self):
        stderr = (
            "*** Terminating app due to uncaught exception 'NSRangeException', "
            "reason: index 0 beyond bounds for empty array in libmlx"
        )
        self.assertTrue(ollama_manager._is_mlx_crash(stderr))
        self.assertFalse(ollama_manager._is_mlx_crash("random startup warning"))

    def test_startup_report_when_no_binary(self):
        with patch.object(ollama_manager, "is_ollama_running", return_value=False), patch.object(
            ollama_manager, "get_ollama_binary_candidates", return_value=[]
        ):
            ok = ollama_manager.start_ollama_server(wait=True, timeout=1)
            self.assertFalse(ok)
            report = ollama_manager.get_last_startup_report()
            self.assertFalse(report["success"])
            self.assertEqual(report["error"], "binary_not_found")

    def test_override_binary_has_priority_over_cached_preferred(self):
        fake_override = Path("/tmp/override-ollama")
        fake_other = Path("/tmp/other-ollama")
        with patch.dict("os.environ", {"OPENSCRIBE_OLLAMA_BINARY": str(fake_override)}), patch.object(
            ollama_manager, "_selected_ollama_binary", fake_other
        ), patch.object(Path, "exists", return_value=True), patch("os.access", return_value=True):
            candidates = ollama_manager.get_ollama_binary_candidates()
            self.assertGreaterEqual(len(candidates), 1)
            self.assertEqual(candidates[0], fake_override)

    def test_default_prefers_system_binary(self):
        bundled_dir = Path("/tmp/fake-bundle")
        with patch.dict("os.environ", {}, clear=True), patch.object(
            ollama_manager, "get_bundled_ollama_dir", return_value=bundled_dir
        ), patch("subprocess.run", return_value=SimpleNamespace(returncode=0, stdout="/opt/homebrew/bin/ollama\n")), patch.object(
            Path, "exists", return_value=True
        ), patch("os.access", return_value=True):
            candidates = ollama_manager.get_ollama_binary_candidates()
            self.assertGreaterEqual(len(candidates), 2)
            self.assertEqual(candidates[0], Path("/opt/homebrew/bin/ollama"))


if __name__ == "__main__":
    unittest.main()
