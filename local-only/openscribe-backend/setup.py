from pathlib import Path
from setuptools import setup, find_packages

with open("requirements.txt", "r") as f:
    requirements = [line.strip() for line in f if line.strip() and not line.startswith("#")]

root = Path(__file__).parent
readme_path = root / "README.md"
if readme_path.exists():
    long_description = readme_path.read_text(encoding="utf-8")
else:
    long_description = "OpenScribe local backend runtime"

setup(
    name="openscribe-backend",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    python_requires=">=3.8",
    install_requires=requirements,
    entry_points={
        'console_scripts': [
            'openscribe-backend=main:cli',
        ],
    },
    author="OpenScribe",
    description="AI-powered meeting transcription and analysis for Mac",
    long_description=long_description,
    long_description_content_type="text/markdown",
)
