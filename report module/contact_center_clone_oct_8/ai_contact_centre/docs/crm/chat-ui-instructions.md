# Chat UI instructions

A chat reply is a short stack of HTML blocks. The chat applies the spacing, the card, the bullet, and the table header. The reply does not set margins, colors, or classes. It chooses the right block, in the right order, with the right label.

Allowed tags: `p`, `ul`, `ol`, `li`, `strong`, `em`, `br`, `span`, `table`, `thead`, `tbody`, `tr`, `th`, `td`.

Send no `class`, `style`, `id`, heading tags, links, or Markdown. A heading tag is unwrapped and the title loses its weight. Markdown bold stays as asterisks.

## Page rhythm

Build the reply in this order. Each block is a sibling. A list or table is never inside a `p`.

1. Title, one `p`.
2. One card: a `ul` for a few labeled facts, or a `table` when there are columns.
3. A section title, one `p`, only when a second card follows.
4. The second card.
5. One closing `p` when a question or a note is needed.

```text
p     title
ul    labeled facts
p     section title
ul    second group
p     closing note
```

```text
p       intro
table   rows
p       closing question
```

That order creates the spacing:

| Place | What the chat does |
| --- | --- |
| Between two paragraphs | 12px |
| Paragraph sitting on a card | The paragraph's bottom gap closes so the title sits on the card |
| Around a list card or a table card | 20px above and below |
| Paragraph after a card | 16px before the next sentence |
| Inside a list row | 10px above and below the row, 2px between rows |
| Inside a table cell | 10px top and bottom, 12px left and right |

Do not add blank paragraphs, `<br><br>`, or empty list items to create space. Extra breaks pile on top of the 20px card margin and the card looks loose.

## Title

The title is a paragraph, not a heading.

```html
<p><strong>Morning brief</strong> — 7 Oct</p>
```

The lead words are the only bold part. The words after the em dash stay regular. One line. No period unless the title is a full sentence.

A section title between two cards uses the same pattern:

```html
<p><strong>Open items</strong></p>
```

An intro before a table is a normal sentence, with no bold unless a number matters:

```html
<p>Here are 3 rows:</p>
```

## Lists

A top-level `ul` becomes a card: 12px corners, a hairline border, a light gray fill, and 14px of padding inside. Bullets are a small gray dot. You do not draw the dot.

Each fact is one `li`. The label is a single `<strong>` at the start. A colon and a space follow it. The rest of the item is the value.

```html
<li><strong>Status</strong>: Open</li>
<li><strong>Owner</strong>: Support</li>
```

The chat then stacks that row:

```text
Status
Open
```

The label is 14px and near-black. The value sits 2px under it, in gray. This stack happens only when the item has exactly one `<strong>` or `<b>`, and that tag is the first element. The chat moves the value into a span so the CSS can place it under the label.

Skip a fact the source did not return. Do not add a row that says Unknown.

A long note stays in the same item. Do not split it with `<br>`.

```html
<li><strong>Note</strong>: Waiting on a reply. Nothing else is pending.</li>
```

A second group is its own list, after its own title. Do not nest it inside the first list. A list inside a list item keeps the inner label on the same line as the value, so those labels do not stack.

```html
<p><strong>Morning brief</strong> — 7 Oct</p>
<ul>
  <li><strong>Status</strong>: Open</li>
  <li><strong>Owner</strong>: Support</li>
  <li><strong>Updated</strong>: 7 Oct 2026</li>
</ul>
<p><strong>Open items</strong></p>
<ul>
  <li><strong>Queue</strong>: 4 waiting, oldest 12m</li>
  <li><strong>Callback</strong>: 1 due this hour</li>
</ul>
```

Use `ol` only for a sequence the reader must follow. Those items are numbered. Facts use `ul`.

## Tables

Several rows with the same columns are a table, not a list of the same rows. The chat wraps the table in a white card with the same 12px corners and hairline border. Wide tables scroll sideways. The first column stays pinned on the left.

Headers are short title-case words. The chat draws them as small uppercase labels on a gray bar.

```html
<p>Here are 3 rows:</p>
<table>
  <thead>
    <tr>
      <th>Queue</th>
      <th>Waiting</th>
      <th>Oldest</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Support</td>
      <td>4</td>
      <td>12m</td>
    </tr>
    <tr>
      <td>Billing</td>
      <td>—</td>
      <td>3m</td>
    </tr>
    <tr>
      <td>Sales</td>
      <td>1</td>
      <td>8m</td>
    </tr>
  </tbody>
</table>
<p>Support has the oldest wait. Should I open that queue?</p>
```

Table rules that keep the grid even:

- Always include `<thead>`, `<tbody>`, and one `<th>` for every column. A missing header row leaves the table unstyled.
- One record per `<tr>`. Cell text is plain. Do not bold every cell in the first column.
- An empty value is the character `—`. An empty `<td></td>` collapses the column.
- Keep cell text on one line. The cell does not wrap, and each column is at least 256px wide, so a sentence inside a cell forces a long sideways scroll.
- Do not repeat the same rows as a list under the table.
- When two rows need a choice, keep both rows. The closing paragraph asks which one.

## Closing line

After the last card, one paragraph. It is a question or one fact that did not fit a column. It starts 16px below the card.

```html
<p>Support has the oldest wait. Should I open that queue?</p>
```

If nothing matched, send only that paragraph. No empty table and no empty list.

```html
<p>Nothing matched that search.</p>
```

## CSS

The chat wraps the reply in `.assistant-message-html`. It wraps each top-level list in `.assistant-list-wrap` and each table in `.assistant-table-wrap`. It moves the text after a single label into `.assistant-list-desc`. The reply does not include these classes. A page that renders the same HTML outside the chat adds the wrappers, then uses the CSS below.

The message box is 14px, `#171717`, with a line height of 1.7. Lists and tables inherit it.

### Message box, spacing, and titles

```css
.assistant-message-html {
  min-width: 0;
  max-width: 100%;
  color: #171717;
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.assistant-message-html > :first-child {
  margin-top: 0;
}

.assistant-message-html > :last-child {
  margin-bottom: 0;
}

.assistant-message-html p {
  margin: 0 0 12px;
  line-height: 1.7;
}

.assistant-message-html strong,
.assistant-message-html b {
  font-weight: 600;
  color: #171717;
}

.assistant-message-html p:has(+ .assistant-list-wrap),
.assistant-message-html p:has(+ .assistant-table-wrap),
.assistant-message-html p:has(+ ul),
.assistant-message-html p:has(+ ol),
.assistant-message-html p:has(+ table) {
  margin-bottom: 0;
}

.assistant-message-html ul + p,
.assistant-message-html ol + p,
.assistant-list-wrap + p,
.assistant-table-wrap + p {
  margin-top: 16px;
}
```

### Lists

```css
.assistant-list-wrap {
  margin: 20px 0;
  padding: 14px 16px;
  overflow: hidden;
  border: 0.6px solid #bfbfbf;
  border-radius: 12px;
  background: #fafafa;
}

.assistant-message-html ul,
.assistant-message-html ol {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  background: transparent;
}

.assistant-message-html li {
  position: relative;
  margin: 0;
  padding: 10px 0 10px 16px;
  line-height: 1.5;
  color: #525252;
}

.assistant-message-html li + li {
  margin-top: 2px;
}

.assistant-message-html li:has(> .assistant-list-desc) > strong:first-child,
.assistant-message-html li:has(> .assistant-list-desc) > b:first-child {
  display: block;
  font-size: 14px;
  line-height: 1.4;
}

.assistant-message-html .assistant-list-desc {
  display: block;
  margin-top: 2px;
  font-size: 14px;
  line-height: 1.5;
  color: #525252;
}

.assistant-message-html ul > li::before {
  content: "";
  position: absolute;
  top: 17px;
  left: 0;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #858f96;
}
```

### Tables

```css
.assistant-table-wrap {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 20px 0;
  overflow-x: auto;
  border: 0.6px solid #bfbfbf;
  border-radius: 12px;
  background: #fff;
}

.assistant-message-html table {
  margin: 0;
  width: max(100%, max-content);
  min-width: 100%;
  table-layout: auto;
  border-collapse: collapse;
  background: #fff;
}

.assistant-message-html th,
.assistant-message-html td {
  box-sizing: border-box;
  min-width: 256px;
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
  border: 0;
  border-bottom: 0.6px solid #e5e5e5;
}

.assistant-message-html th {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #171717;
  background: #e2e2e6;
  border-bottom: 0.6px solid #bfbfbf;
}

.assistant-message-html td {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: #171717;
}

.assistant-message-html th:first-child,
.assistant-message-html td:first-child {
  position: sticky;
  left: 0;
}

.assistant-message-html th:first-child {
  background: #e2e2e6;
  z-index: 2;
}

.assistant-message-html td:first-child {
  background: #fff;
  z-index: 1;
}

.assistant-message-html tbody tr:last-child td {
  border-bottom: 0;
}
```

## What makes the spacing break

- A list or table inside `<p>` joins the title and the card into one block.
- Two `<strong>` tags in one `<li>` leave the label and the value on one line.
- A nested list under a parent item loses the stacked label.
- `<h2>` or `<div>` is removed, so the title becomes loose text with no gap.
- `<br>` between facts adds a gap the card padding already provides.
- A table without `<th>` has no gray header and no pinned first column.
