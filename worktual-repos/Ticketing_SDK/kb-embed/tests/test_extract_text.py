import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_text import ExtractError, extract_file_text


class ExtractTextTests(unittest.TestCase):
    def test_plain_txt(self):
        text = extract_file_text(b"Hello article body here.", "guide.txt")
        self.assertEqual(text, "Hello article body here.")

    def test_markdown(self):
        text = extract_file_text(b"# Title\n\nBody", "note.md")
        self.assertIn("Body", text)

    def test_unsupported_xlsx(self):
        with self.assertRaises(ExtractError):
            extract_file_text(b"PK", "sheet.xlsx")

    def test_unknown_extension(self):
        with self.assertRaises(ExtractError):
            extract_file_text(b"data", "file.bin")


if __name__ == "__main__":
    unittest.main()
