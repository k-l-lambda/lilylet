import assert from "assert";
import fs from "fs";
import path from "path";
import {
	decodeWithModel,
	encodeWithModel,
	extractProtectedTokensFromSerializer,
	preTokenize,
	trainBpe,
} from "../../tools/trainBpeTokenizer";


const serializerPath = path.resolve("source/lilylet/serializer.ts");
const protectedTokens = extractProtectedTokensFromSerializer(serializerPath);

for (const token of [
	"\\clef",
	"\\key",
	"\\time",
	"\\partial",
	"\\numericTimeSignature",
	"\\staff",
	"\\tuplet",
	"\\times",
	"\\repeat",
	"\\rest",
	"\\trill",
	"\\sustainOn",
	"treble",
	"alto",
	"!",
	"s",
	"f",
	".",
	"_",
	"^",
	"auto-beam",
	"\n",
	" ",
	"(",
	")",
	"<",
	">",
	"'",
	",",
	"/",
	"%",
]) {
	assert.ok(protectedTokens.includes(token), `Expected protected token: ${token}`);
}

for (const token of protectedTokens) {
	assert.ok(
		Buffer.byteLength(token, "utf8") > 1 || ["\n", " ", "(", ")", "<", ">", "'", ",", "/", "%", "!", "s", "f", ".", "_", "^", "-", "p"].includes(token),
		`Expected multi-byte or explicitly reserved protected token: ${JSON.stringify(token)}`,
	);
}

{
	const protectedTokenIds = new Map<string, number>();
	protectedTokens.forEach((token, index) => protectedTokenIds.set(token, 256 + index));
	const encoded = preTokenize("\\ppp \\pp \\p \\stemNeutral", protectedTokens, protectedTokenIds);
	assert.equal(encoded[0], protectedTokenIds.get("\\ppp"), "Expected longest match for \\ppp");
	assert.ok(encoded.includes(protectedTokenIds.get("\\stemNeutral")!), "Expected protected \\stemNeutral token");
}

{
	const texts = ["\\staff \"1\" \\clef \"treble\" \\key c \\major \\time 4/4 c4 d e f | %1\n"];
	const result = trainBpe(texts, {
		vocabSize: 240,
		minFrequency: 2,
		protectedTokens,
	});
	const model = {
		vocab: result.vocab,
		merges: result.merges,
		protectedTokens: result.protectedTokens,
	};
	const encoded = encodeWithModel(texts[0], model);
	const decoded = decodeWithModel(encoded, model);
	assert.equal(decoded, texts[0], "Expected exact encode/decode round trip");
	assert.ok(result.tokenFrequencies.length > 0, "Expected token frequency output");
	for (let i = 1; i < result.tokenFrequencies.length; i++) {
		assert.ok(
			result.tokenFrequencies[i - 1].frequency >= result.tokenFrequencies[i].frequency,
			"Expected token frequencies sorted descending",
		);
	}
}

{
	const texts = [
		"\\clef treble c4 d e f | %1\n",
		"\\clef bass c,4 d e f | %2\n",
	];
	const a = trainBpe(texts, { vocabSize: 240, minFrequency: 2, protectedTokens });
	const b = trainBpe(texts, { vocabSize: 240, minFrequency: 2, protectedTokens });
	assert.deepEqual(a.protectedTokens, b.protectedTokens, "Expected deterministic protected tokens");
	assert.deepEqual(a.merges, b.merges, "Expected deterministic merges");
}

{
	assert.throws(
		() => trainBpe(["abc"], { vocabSize: 2, minFrequency: 2, protectedTokens }),
		/vocab-size 2 is too small/,
		"Expected clear error for too-small vocab size",
	);
}

assert.ok(fs.existsSync(serializerPath), "Serializer path should exist");
console.log("BPE tokenizer tests passed");
