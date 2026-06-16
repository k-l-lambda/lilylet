/**
 * Staff-layout parser, ported from FindLab starry (app/staffLayout/).
 *
 * The layout string uses STAFF as the leaf unit (distinct from ABC's %%score,
 * which is voice-leaf). Brackets group staves: `{}` = Brace (grand staff),
 * `<>` = Bracket, `[]` = Square; conjunctions between consecutive staves:
 * `,` = Blank, `-` = Solid, `.` = Dashed. Staff ids are [a-zA-Z_0-9]+; a slot
 * with no id is an anonymous staff (auto-named "1","2",…).
 *
 * Example: "<[v1-v2].va> {pl-pr} <b>" → 6 staves v1,v2,va,pl,pr,b grouped as
 * a Bracket over { a Square [v1-v2] dashed-joined to va }, a Brace {pl-pr},
 * and a Bracket <b>.
 */

export enum StaffGroupType {
	Default = 0,
	Brace = 1,   // {}
	Bracket = 2, // <>
	Square = 3,  // []
}

export enum StaffConjunctionType {
	Blank = 0,
	Dashed = 1,
	Solid = 2,
}

export interface RawItem {
	id: string | null;
	leftBounds: string[];
	rightBounds: string[];
	conjunction: string | null;
}

export interface StaffGroup {
	type: StaffGroupType;
	subs?: StaffGroup[];
	staff?: string;
	level?: number;
	grand?: boolean;
	key?: string;
	bar?: number;
}

export interface StaffGroupTrait {
	group: StaffGroup;
	range: [number, number];
	key: string;
}

const singleGroup = (id: string): StaffGroup => ({ type: StaffGroupType.Default, staff: id });

const BOUNDS_TO_GROUPTYPE: { [bound: string]: StaffGroupType } = {
	"{": StaffGroupType.Brace,
	"}": StaffGroupType.Brace,
	"<": StaffGroupType.Bracket,
	">": StaffGroupType.Bracket,
	"[": StaffGroupType.Square,
	"]": StaffGroupType.Square,
};

const OPEN_BOUNDS = "{<[";
const CLOSE_BOUNDS = "}>]";

const CONJUNCTIONS_MAP: { [conj: string]: StaffConjunctionType } = {
	",": StaffConjunctionType.Blank,
	"-": StaffConjunctionType.Solid,
	".": StaffConjunctionType.Dashed,
};

// MEI staffGrp @symbol by StaffGroupType (Default → none). MEI's allowed values
// are brace | bracket | bracketsq | line | none — note the square variant is
// "bracketsq", NOT "square" (the latter is MusicXML's <group-symbol> value).
const GROUP_SYMBOLS_MEI: (string | null)[] = [null, "brace", "bracket", "bracketsq"];

const randomB64 = (): string => {
	const code = Buffer.from(Math.random().toString().slice(2)).toString("base64").replace(/=/g, "");
	return code.split("").reverse().slice(0, 6).join("");
};

const makeUniqueName = (set: Set<string>, index: number, prefix?: string): string => {
	let name = prefix;
	if (!name) name = index.toString();
	else if (set.has(name)) name += "_" + index.toString();

	while (set.has(name)) name = (prefix ? prefix + "_" : "") + randomB64();

	return name;
};

// Tokenize a layout string into RawItem[] (one per staff slot). Lexer: whitespace
// skipped, single chars [-,.{}<>[]] are bounds/conjunctions, [a-zA-Z_0-9]+ is an id.
// An item accumulates leading open-bounds (leftBounds), an optional id, trailing
// close-bounds (rightBounds); a conjunction terminates the item and starts the next.
const tokenize = (code: string): RawItem[] => {
	const tokens = code.match(/[A-Za-z0-9_]+|[-,.{}<>\[\]]/g) || [];
	const items: RawItem[] = [];
	let cur: RawItem = { id: null, leftBounds: [], rightBounds: [], conjunction: null };
	let seenId = false;       // id slot filled for the current item
	let seenRight = false;    // started collecting right bounds / closing

	const pushItem = () => {
		items.push(cur);
		cur = { id: null, leftBounds: [], rightBounds: [], conjunction: null };
		seenId = false;
		seenRight = false;
	};

	for (const tok of tokens) {
		if (tok in CONJUNCTIONS_MAP) {
			cur.conjunction = tok;
			pushItem();
			continue;
		}
		if (OPEN_BOUNDS.includes(tok)) {
			// An open bound after the id/closing starts a fresh item's left bounds.
			if (seenId || seenRight) pushItem();
			cur.leftBounds.push(tok);
			continue;
		}
		if (CLOSE_BOUNDS.includes(tok)) {
			cur.rightBounds.push(tok);
			seenRight = true;
			continue;
		}
		// id token
		if (seenId || seenRight) pushItem();
		cur.id = tok;
		seenId = true;
	}
	// Flush the final item if it carries any content.
	if (cur.id !== null || cur.leftBounds.length || cur.rightBounds.length) pushItem();

	return items;
};

const makeGroupsFromRaw = (parent: StaffGroup, seq: string[]): string[] => {
	let remains = seq;
	while (remains.length) {
		const word = remains.shift() as string;
		const bound = BOUNDS_TO_GROUPTYPE[word];
		if (bound !== undefined) {
			if (CLOSE_BOUNDS.includes(word) && bound === parent.type) break;

			if (OPEN_BOUNDS.includes(word)) {
				const group: StaffGroup = { type: bound, level: Number.isFinite(parent.level as number) ? (parent.level as number) + 1 : 0 };
				remains = makeGroupsFromRaw(group, remains);

				parent.subs = parent.subs || [];
				parent.subs.push(group);
			}
		} else {
			parent.subs = parent.subs || [];
			parent.subs.push(singleGroup(word));
		}
	}

	while (parent.type === StaffGroupType.Default && parent.subs && parent.subs.length === 1) {
		const sub = parent.subs[0];
		parent.type = sub.type;
		parent.subs = sub.subs;
		parent.staff = sub.staff;
		parent.level = sub.level;
	}

	while (parent.subs && parent.subs.length === 1 && parent.subs[0].type === StaffGroupType.Default) {
		const sub = parent.subs[0];
		parent.subs = sub.subs;
		parent.staff = sub.staff;
	}

	parent.grand = parent.type === StaffGroupType.Brace && !!parent.subs && parent.subs.every(sub => !!sub.staff);

	return remains;
};

const groupHead = (group: StaffGroup): string | undefined => {
	if (group.staff) return group.staff;
	else if (group.subs) return groupHead(group.subs[0]);
};

const groupTail = (group: StaffGroup): string | undefined => {
	if (group.staff) return group.staff;
	else if (group.subs) return groupTail(group.subs[group.subs.length - 1]);
};

export const groupKey = (group: StaffGroup): string | undefined => {
	if (group.staff) return group.staff;
	else if (group.subs) return `${groupHead(group)}-${groupTail(group)}`;
};

const groupDict = (group: StaffGroup, dict: { [key: string]: StaffGroup }): void => {
	const key = groupKey(group);
	if (key !== undefined) dict[key] = group;
	if (group.subs) group.subs.forEach(sub => groupDict(sub, dict));
};

export class StaffLayout {
	staffIds: string[];
	conjunctions: StaffConjunctionType[];
	group: StaffGroup;
	groups: StaffGroupTrait[];

	constructor(raw: RawItem[]) {
		// make unique ids (anonymous slots get "1","2",… ; named collisions disambiguated)
		const ids = new Set<string>();
		raw.forEach((item, i) => {
			item.id = makeUniqueName(ids, i + 1, item.id || undefined);
			ids.add(item.id);
		});
		this.staffIds = raw.map(item => item.id as string);
		this.conjunctions = raw.slice(0, raw.length - 1).map(item => item.conjunction ? CONJUNCTIONS_MAP[item.conjunction] : StaffConjunctionType.Blank);

		// make groups
		const seq = ([] as string[]).concat(...raw.map(item => [...item.leftBounds, item.id as string, ...item.rightBounds]));
		this.group = { type: StaffGroupType.Default };
		makeGroupsFromRaw(this.group, seq);

		const dict: { [key: string]: StaffGroup } = {};
		groupDict(this.group, dict);
		this.groups = Object.entries(dict).map(([key, group]) => {
			let ids = key.split("-");
			if (ids.length === 1) ids = [ids[0], ids[0]];
			const range = ids.map(id => this.staffIds.indexOf(id)) as [number, number];

			const cons = this.conjunctions.slice(range[0], range[1]);
			const bar = cons.length ? Math.min(...cons) : 0;

			group.key = key;
			group.bar = bar;

			return { group, range, key };
		});
	}

	get stavesCount(): number {
		return this.staffIds.length;
	}
}

export const parseStaffLayout = (code: string): StaffLayout => new StaffLayout(tokenize(code));

// ── Staff-layout serialization (inverse of parseStaffLayout) ──
// Reconstruct a layout string from a parsed StaffLayout by walking the group tree,
// so every staff slot and conjunction is preserved structurally (a regex strip of the
// ids would drop a BARE anonymous leaf — its empty token gets swallowed by whitespace).
//
// `anonymous` emits empty ids (the parser re-auto-names slots "1","2",… by position).
// `idMap` optionally overrides individual staff ids by their original id.
//
// Conjunction rendering: Solid → "-", Dashed → ".", Blank → " " ONLY when both sides
// are bracketed groups (the brackets self-delimit the slots); otherwise Blank → ","
// so an adjacent empty/bare leaf still tokenizes as its own slot.

const CONJ_CHAR: { [c in StaffConjunctionType]: string } = {
	[StaffConjunctionType.Solid]: "-",
	[StaffConjunctionType.Dashed]: ".",
	[StaffConjunctionType.Blank]: ",",
};

export interface SerializeStaffLayoutOptions {
	anonymous?: boolean;
	idMap?: (originalId: string) => string;
}

export const serializeStaffLayout = (layout: StaffLayout, options: SerializeStaffLayoutOptions = {}): string => {
	const { anonymous = false, idMap } = options;
	const isGrouped = (group: StaffGroup): boolean => group.type !== StaffGroupType.Default && !!group.subs;

	const leafText = (id: string): string => (anonymous ? "" : idMap ? idMap(id) : id);

	// flat leaf index of a group's first / last staff (for the inter-child conjunction).
	const firstLeafIndex = (group: StaffGroup): number => layout.staffIds.indexOf(groupHead(group)!);
	const lastLeafIndex = (group: StaffGroup): number => layout.staffIds.indexOf(groupTail(group)!);

	const sep = (conj: StaffConjunctionType, left: StaffGroup, right: StaffGroup): string => {
		if (conj !== StaffConjunctionType.Blank) return CONJ_CHAR[conj];
		// Blank: a space is safe only when both neighbours are bracketed (self-delimiting).
		return isGrouped(left) && isGrouped(right) ? " " : ",";
	};

	const emit = (group: StaffGroup): string => {
		if (!group.subs) return leafText(group.staff!);  // Default leaf

		const open = group.type === StaffGroupType.Brace ? "{" : group.type === StaffGroupType.Bracket ? "<" : group.type === StaffGroupType.Square ? "[" : "";
		const close = group.type === StaffGroupType.Brace ? "}" : group.type === StaffGroupType.Bracket ? ">" : group.type === StaffGroupType.Square ? "]" : "";

		let inner = "";
		group.subs.forEach((sub, i) => {
			inner += emit(sub);
			if (i < group.subs!.length - 1) {
				const next = group.subs![i + 1];
				const conj = layout.conjunctions[lastLeafIndex(sub)] ?? StaffConjunctionType.Blank;
				inner += sep(conj, sub, next);
				void firstLeafIndex;  // (lastLeafIndex(sub) === firstLeafIndex(next) - 1)
			}
		});
		return open + inner + close;
	};

	let out = emit(layout.group);

	// A TRAILING bare anonymous leaf emits "" with nothing after it to delimit the slot
	// (a leaf before a closing bracket is fine — the bracket gives it bounds; an internal
	// one is flushed by the next separator). The tokenizer only flushes a final empty item
	// if it carries bounds, so append one "," to materialize that last empty slot. This only
	// arises when the OUTERMOST container is the Default sequence (no enclosing bracket) and
	// its last child is a bare leaf; if the whole layout is wrapped in a bracket, the closing
	// bracket already delimits the final leaf. The trailing conjunction is dropped on re-parse
	// (conjunctions = items[0..n-1]), so it is harmless. Anonymous output only.
	if (anonymous && layout.group.type === StaffGroupType.Default && layout.group.subs) {
		const lastTop = layout.group.subs[layout.group.subs.length - 1];
		if (!lastTop.subs && lastTop.staff !== undefined) out += ",";
	}

	return out;
};

// ── MEI staffGrp encoding (ported from FindLab staffLayout/encoding.js encodeMEI) ──
// Recursively emit nested <staffGrp> with symbol (brace/bracket/square) and bar.thru,
// with <staffDef n="..."> leaves keyed by staff index. nameDict maps a group key to a
// label. Returns the inner XML (no <scoreDef> wrapper); the caller positions it.

const bool = (x: boolean): string => (x ? "true" : "false");

const stateMEIGroup = (
	statements: string[],
	group: StaffGroup,
	nameDict: { [key: string]: string },
	ids: string[],
	indent: number,
	tab: string,
): void => {
	const pad = tab.repeat(indent);
	const name = group.key !== undefined ? nameDict[group.key] : undefined;

	if (group.subs) {
		const symbol = GROUP_SYMBOLS_MEI[group.type] ? ` symbol="${GROUP_SYMBOLS_MEI[group.type]}"` : "";
		statements.push(`${pad}<staffGrp bar.thru="${bool((group.bar ?? 0) > 1)}"${symbol}>`);
		if (name) statements.push(`${pad}${tab}<label>${name}</label>`);
		group.subs.forEach(sub => stateMEIGroup(statements, sub, nameDict, ids, indent + 1, tab));
		statements.push(`${pad}</staffGrp>`);
	}

	if (group.staff) statements.push(`${pad}<staffDef n="${ids.indexOf(group.staff) + 1}">`);
};

export const encodeStaffLayoutMEI = (
	layout: StaffLayout,
	nameDict: { [key: string]: string } = {},
	indent = 0,
	tab = "\t",
): string => {
	const statements: string[] = [];
	stateMEIGroup(statements, layout.group, nameDict, layout.staffIds, indent, tab);
	return statements.join("\n");
};
