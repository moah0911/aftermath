'use strict';

// aftermath command-file frontmatter parser.
//
// Isolated in its own module so the plugin file's only function export is the
// plugin itself. OpenCode's legacy plugin loader treats every exported function
// as a plugin; calling a helper with the plugin context object would throw.

function parseCommandFile(filePath) {
  const fs = require('fs');
  const content = fs.readFileSync(filePath, 'utf8');
  // Tolerate CRLF: Windows checkouts deliver \r\n, npm ships \n.
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const description = match[1].match(/description:\s*(.+)/)?.[1]?.trim();
  return { description, template: match[2].trim() };
}

module.exports = { parseCommandFile };
