import tempfile
import unittest
from pathlib import Path

from src.config import Config


class ConfigTests(unittest.TestCase):
    def test_defaults_include_setup_and_telemetry_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(Path(tmp) / "config.json")
            self.assertFalse(cfg.get_telemetry_enabled())
            self.assertFalse(cfg.is_setup_completed())
            self.assertEqual(cfg.get_runtime_preference(), "mixed")
            self.assertEqual(cfg.get("model_catalog_version"), "v1")

    def test_rejects_unsupported_models_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(Path(tmp) / "config.json")
            ok = cfg.set_model("unsupported:model")
            self.assertFalse(ok)
            self.assertEqual(cfg.get_model(), cfg.DEFAULT_MODEL)

    def test_accepts_supported_model_and_persists_selected_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Config(Path(tmp) / "config.json")
            ok = cfg.set_model("gemma3:4b")
            self.assertTrue(ok)
            self.assertEqual(cfg.get_model(), "gemma3:4b")
            self.assertEqual(cfg.get("selected_model"), "gemma3:4b")


if __name__ == "__main__":
    unittest.main()
