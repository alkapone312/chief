/**
 * Dependency-free QR Code Model 2 encoder.
 *
 * Fixed version: 5 (37 × 37 modules), error-correction level: L.
 * Supports UTF-8 URLs up to 106 bytes. The format uses byte mode and mask 0.
 */
class QrCode {
    static multiply(x, y) {
        let result = 0;

        for (let bit = 7; bit >= 0; bit--) {
            result = (result << 1) ^ ((result >>> 7) * 0x11d);
            result ^= ((y >>> bit) & 1) * x;
        }

        return result & 255;
    }

    static correctionBytes(data, count) {
        let generator = [1];

        for (let i = 0, root = 1; i < count; i++, root = this.multiply(root, 2)) {
            const next = new Array(generator.length + 1).fill(0);

            generator.forEach((value, index) => {
                next[index] ^= value;
                next[index + 1] ^= this.multiply(value, root);
            });

            generator = next;
        }

        const remainder = new Array(count).fill(0);

        for (const byte of data) {
            const factor = byte ^ remainder.shift();
            remainder.push(0);

            for (let i = 0; i < count; i++) {
                remainder[i] ^= this.multiply(generator[i + 1], factor);
            }
        }

        return remainder;
    }

    static encodeBits(url) {
        const bytes = Array.from(new TextEncoder().encode(url));

        if (bytes.length > 106) {
            throw new Error("errors.client.qrTooLong");
        }

        const bits = [];
        const addBits = (value, count) => {
            for (let bit = count - 1; bit >= 0; bit--) {
                bits.push((value >>> bit) & 1);
            }
        };

        addBits(4, 4);
        addBits(bytes.length, 8);
        bytes.forEach((byte) => addBits(byte, 8));

        for (let i = 0; i < Math.min(4, 864 - bits.length); i++) {
            bits.push(0);
        }

        while (bits.length % 8 !== 0) {
            bits.push(0);
        }

        const data = [];

        for (let offset = 0; offset < bits.length; offset += 8) {
            data.push(parseInt(bits.slice(offset, offset + 8).join(""), 2));
        }

        for (let i = 0; data.length < 108; i++) {
            data.push(i % 2 ? 0x11 : 0xec);
        }

        const codewords = data.concat(this.correctionBytes(data, 26));

        return codewords.flatMap((word) => {
            const result = [];

            for (let bit = 7; bit >= 0; bit--) {
                result.push((word >>> bit) & 1);
            }

            return result;
        });
    }

    static make(url) {
        const payload = this.encodeBits(url);
        const size = 37;
        const matrix = Array.from({ length: size }, () => Array(size).fill(0));
        const reserved = Array.from({ length: size }, () => Array(size).fill(false));

        const set = (x, y, value) => {
            if (x >= 0 && x < size && y >= 0 && y < size) {
                matrix[y][x] = Number(Boolean(value));
                reserved[y][x] = true;
            }
        };

        const finder = (left, top) => {
            for (let y = -1; y <= 7; y++) {
                for (let x = -1; x <= 7; x++) {
                    const dark = x >= 0 && x <= 6 && y >= 0 && y <= 6 &&
                        (x === 0 || x === 6 || y === 0 || y === 6 ||
                        (x >= 2 && x <= 4 && y >= 2 && y <= 4));

                    set(left + x, top + y, dark);
                }
            }
        };

        finder(0, 0);
        finder(size - 7, 0);
        finder(0, size - 7);

        for (let i = 8; i < size - 8; i++) {
            set(i, 6, i % 2 === 0);
            set(6, i, i % 2 === 0);
        }

        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
                set(x + 28, y + 28,
                    x === 0 || x === 4 || y === 0 || y === 4 ||
                    (x === 2 && y === 2));
            }
        }

        // Fixed dark module for version 5.
        set(8, size - 8, 1);

        const firstFormatLocations = [];

        for (let i = 0; i <= 5; i++) {
            firstFormatLocations.push([8, i]);
        }

        firstFormatLocations.push([8, 7], [8, 8], [7, 8]);

        for (let i = 5; i >= 0; i--) {
            firstFormatLocations.push([i, 8]);
        }

        const secondFormatLocations = [];

        for (let i = 0; i < 8; i++) {
            secondFormatLocations.push([size - 1 - i, 8]);
        }

        for (let i = 8; i < 15; i++) {
            secondFormatLocations.push([8, size - 15 + i]);
        }

        const formatData = 8; // Low error correction, mask pattern 0.
        let remainder = formatData << 10;

        for (let bit = 14; bit >= 10; bit--) {
            if ((remainder >>> bit) & 1) {
                remainder ^= 0x537 << (bit - 10);
            }
        }

        const format = ((formatData << 10) | remainder) ^ 0x5412;

        for (let i = 0; i < 15; i++) {
            const bit = (format >>> i) & 1;
            set(...firstFormatLocations[i], bit);
            set(...secondFormatLocations[i], bit);
        }

        let cursor = 0;

        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) {
                right = 5;
            }

            for (let vertical = 0; vertical < size; vertical++) {
                const fromBottom = ((right + 1) & 2) === 0;
                const y = fromBottom ? size - 1 - vertical : vertical;

                for (let column = 0; column < 2; column++) {
                    const x = right - column;

                    if (!reserved[y][x]) {
                        const bit = payload[cursor++] || 0;
                        const masked = bit ^ (Number((x + y) % 2 === 0));
                        matrix[y][x] = masked;
                    }
                }
            }
        }

        const modules = [];

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (matrix[y][x]) {
                    modules.push(
                        '<rect x="' + (x + 4) + '" y="' + (y + 4) +
                        '" width="1" height="1"/>'
                    );
                }
            }
        }

        return [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"',
            ' width="240" height="240" role="img" aria-label="Guest QR code">',
            '<rect width="45" height="45" fill="white"/>',
            '<g fill="#15251f">',
            modules.join(""),
            "</g></svg>"
        ].join("");
    }
}

window.QR = QrCode;
