import { readFile } from 'node:fs/promises';
import pdfParse from 'pdf-parse';

// PDF only, per Task 7.1 scope ("prioritizing PDF"). Other formats are
// explicitly out of scope for this foundation task, not silently supported.
export const SUPPORTED_FORMATS = ['pdf'];

/**
 * Extracts plain text from a PDF resume file on disk.
 *
 * @param {string} filePath
 * @returns {Promise<string>} trimmed extracted text
 * @throws {Error} if the file contains no extractable text layer (e.g. a
 *   scanned/image-only PDF) - OCR is out of scope for this task, so this is
 *   surfaced clearly rather than silently producing an empty profile.
 */
export async function extractResumeText(filePath) {
    const buffer = await readFile(filePath);
    const result = await pdfParse(buffer);
    const text = result.text.trim();

    if (!text) {
        throw new Error(
            `No extractable text found in "${filePath}". The PDF may be a scanned image with no text ` +
            `layer - OCR is out of scope for this task.`,
        );
    }

    return text;
}
