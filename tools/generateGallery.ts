import * as fs from 'fs';
import * as path from 'path';

const assetsDir = './tests/assets';
const outputDir = './tests/output';

// Get all lyl files
const lylFiles = fs.readdirSync(assetsDir)
    .filter(f => f.endsWith('.lyl'))
    .sort();

// Read source code for each file
const sources: Record<string, string> = {};
for (const file of lylFiles) {
    const name = file.replace('.lyl', '');
    const content = fs.readFileSync(path.join(assetsDir, file), 'utf-8');
    sources[name] = content;
}

// Categorize files
const getCategory = (name: string): string => {
    if (name.startsWith('accidentals-')) return 'accidentals';
    if (name.startsWith('articulations-')) return 'articulations';
    if (name.startsWith('basic-notes-')) return 'basic-notes';
    if (name.startsWith('beams-')) return 'beams';
    if (name.startsWith('chords-')) return 'chords';
    if (name.startsWith('clefs-')) return 'clefs';
    if (name.startsWith('dots-')) return 'dots';
    if (name.startsWith('durations-')) return 'durations';
    if (name.startsWith('dynamics-')) return 'dynamics';
    if (name.startsWith('grace-')) return 'grace';
    if (name.startsWith('hairpins-')) return 'hairpins';
    if (name.startsWith('key-signatures-')) return 'key-signatures';
    if (name.startsWith('multiple-')) return 'multiple';
    if (name.startsWith('octaves-')) return 'octaves';
    if (name.startsWith('pedals-')) return 'pedals';
    if (name.startsWith('pitch-')) return 'pitch';
    if (name.startsWith('rest-')) return 'rest';
    if (name.startsWith('stem-')) return 'stem';
    if (name.startsWith('tempo-')) return 'tempo';
    if (name.startsWith('ties-')) return 'ties';
    if (name.startsWith('time-signatures-')) return 'time-signatures';
    if (name.startsWith('tremolos-')) return 'tremolos';
    if (name.startsWith('tuplets-')) return 'tuplets';
    if (name.startsWith('demo-')) return 'demo';
    return 'other';
};

// Escape HTML
const escapeHtml = (text: string): string => {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// Generate cards HTML
const cards = Object.keys(sources).map(name => {
    const category = getCategory(name);
    const source = escapeHtml(sources[name].trim());
    return `        <div class="card" data-category="${category}">
            <div class="card-header">${name} <span class="category">${category}</span></div>
            <div class="card-source"><pre><code>${source}</code></pre></div>
            <div class="card-body"><img src="${name}.svg" alt="${name}"></div>
            <div class="card-footer"><a href="${name}.mei">MEI</a><a href="${name}.svg" target="_blank">SVG</a></div>
        </div>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lilylet MEI Test Results</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 10px;
        }
        .stats {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
        }
        .filter-bar {
            display: flex;
            justify-content: center;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .filter-btn {
            padding: 8px 16px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        .filter-btn:hover {
            background: #e0e0e0;
        }
        .filter-btn.active {
            background: #4a90d9;
            color: white;
            border-color: #4a90d9;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
            gap: 20px;
            max-width: 1800px;
            margin: 0 auto;
        }
        .card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .card-header {
            padding: 12px 16px;
            background: #f8f8f8;
            border-bottom: 1px solid #eee;
            font-weight: 500;
            font-size: 14px;
            color: #333;
        }
        .card-header .category {
            color: #888;
            font-weight: normal;
            font-size: 12px;
        }
        .card-source {
            padding: 12px 16px;
            background: #1e1e1e;
            border-bottom: 1px solid #333;
            max-height: 150px;
            overflow: auto;
        }
        .card-source pre {
            margin: 0;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
            line-height: 1.4;
        }
        .card-source code {
            color: #d4d4d4;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .card-body {
            padding: 16px;
            min-height: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
            overflow: auto;
        }
        .card-body img {
            max-width: 100%;
            height: auto;
        }
        .card-footer {
            padding: 8px 16px;
            background: #fafafa;
            border-top: 1px solid #eee;
            font-size: 12px;
        }
        .card-footer a {
            color: #4a90d9;
            text-decoration: none;
            margin-right: 15px;
        }
        .card-footer a:hover {
            text-decoration: underline;
        }
        .hidden {
            display: none;
        }
        @media (max-width: 600px) {
            .grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <h1>Lilylet MEI Test Results</h1>
    <p class="stats">${Object.keys(sources).length} test cases rendered with Verovio</p>

    <div class="filter-bar">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="accidentals">Accidentals</button>
        <button class="filter-btn" data-filter="articulations">Articulations</button>
        <button class="filter-btn" data-filter="basic-notes">Basic Notes</button>
        <button class="filter-btn" data-filter="beams">Beams</button>
        <button class="filter-btn" data-filter="chords">Chords</button>
        <button class="filter-btn" data-filter="clefs">Clefs</button>
        <button class="filter-btn" data-filter="dots">Dots</button>
        <button class="filter-btn" data-filter="durations">Durations</button>
        <button class="filter-btn" data-filter="dynamics">Dynamics</button>
        <button class="filter-btn" data-filter="grace">Grace Notes</button>
        <button class="filter-btn" data-filter="hairpins">Hairpins</button>
        <button class="filter-btn" data-filter="key-signatures">Key Signatures</button>
        <button class="filter-btn" data-filter="multiple">Multiple</button>
        <button class="filter-btn" data-filter="octaves">Octaves</button>
        <button class="filter-btn" data-filter="pedals">Pedals</button>
        <button class="filter-btn" data-filter="pitch">Pitch</button>
        <button class="filter-btn" data-filter="rest">Rests</button>
        <button class="filter-btn" data-filter="stem">Stem</button>
        <button class="filter-btn" data-filter="tempo">Tempo</button>
        <button class="filter-btn" data-filter="ties">Ties/Slurs</button>
        <button class="filter-btn" data-filter="time-signatures">Time Signatures</button>
        <button class="filter-btn" data-filter="tremolos">Tremolos</button>
        <button class="filter-btn" data-filter="tuplets">Tuplets</button>
        <button class="filter-btn" data-filter="demo">Demo</button>
    </div>

    <div class="grid" id="grid">
${cards}
    </div>

    <script>
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filter = btn.dataset.filter;
                document.querySelectorAll('.card').forEach(card => {
                    if (filter === 'all' || card.dataset.category === filter ||
                        card.dataset.category.startsWith(filter)) {
                        card.classList.remove('hidden');
                    } else {
                        card.classList.add('hidden');
                    }
                });
            });
        });
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(outputDir, 'index.html'), html);
console.log(`Generated index.html with ${Object.keys(sources).length} test cases`);
