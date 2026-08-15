#!/usr/bin/env python3
"""Site Editor: click-to-edit the hand-written HTML pages, then publish.

Serves the site at http://127.0.0.1:5026/ in an edit mode where every static
text node is click-editable in place. Saves splice the exact source bytes of
the edited text node back into the file (no parser round-trip, so the
hand-written formatting is never reflowed), and Publish runs git add/commit/
push so GitHub Pages redeploys.

INVARIANTS
- Writes are splices at spans recorded by the indexer; the file is never
  re-serialized from a DOM. A save re-reads the file and verifies each span
  still holds the expected old text before touching anything (staleness guard).
- Edit mode neuters <script> tags in the SERVED copy only, so the DOM the
  browser pairs against is exactly the parsed source. JS-generated content
  (charts, blog cards) is therefore absent in edit mode by design.
- Server binds 127.0.0.1 only.

Run: python3 tools/edit.py   (from anywhere; repo root is derived from
this file's location). Opens the browser on launch.
"""

import html
import json
import os
import re
import subprocess
import sys
import webbrowser
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 5026
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_TAGS = {"script", "style", "title", "svg", "textarea", "head"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


def run_git(*args):
    p = subprocess.run(["git", "-C", ROOT] + list(args),
                       capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


class TextIndexer(HTMLParser):
    """Maps every editable text node to its exact source span.

    Runs with convert_charrefs=False so entity references stay visible as
    events; consecutive data/entity events merge into one node whose raw span
    covers them all and whose decoded text equals what the DOM's textContent
    will report.
    """

    def __init__(self, src):
        super().__init__(convert_charrefs=False)
        self.src = src
        self.line_starts = [0]
        for m in re.finditer("\n", src):
            self.line_starts.append(m.end())
        self.nodes = []       # {id, start, end, text}
        self.skip_depth = 0
        self.cur = None       # accumulating node [start, end, decoded]

    def _off(self):
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def _flush(self):
        if self.cur:
            start, end, text = self.cur
            if text.strip():
                self.nodes.append({"id": len(self.nodes), "start": start,
                                   "end": end, "text": text})
            self.cur = None

    def _extend(self, raw_len, decoded):
        start = self._off()
        if self.cur and self.cur[1] == start:
            self.cur[1] = start + raw_len
            self.cur[2] += decoded
        else:
            self._flush()
            self.cur = [start, start + raw_len, decoded]

    def handle_starttag(self, tag, attrs):
        self._flush()
        if tag in SKIP_TAGS:
            self.skip_depth += 1

    def handle_startendtag(self, tag, attrs):
        self._flush()

    def handle_endtag(self, tag):
        self._flush()
        if tag in SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data):
        if self.skip_depth:
            return
        self._extend(len(data), data)

    def handle_entityref(self, name):
        if self.skip_depth:
            return
        self._extend(len(name) + 2, html.unescape("&%s;" % name))

    def handle_charref(self, name):
        if self.skip_depth:
            return
        self._extend(len(name) + 3, html.unescape("&#%s;" % name))

    def close(self):
        super().close()
        self._flush()


def build_index(path):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    ix = TextIndexer(src)
    ix.feed(src)
    ix.close()
    return src, ix.nodes


def neuter_scripts(src):
    """Disable script execution in the served editing copy."""
    return re.sub(r"<script\b", '<script type="text/plain" data-neutered',
                  src, flags=re.I)


CLIENT_JS = r"""
(function(){
'use strict';
var FILE = document.documentElement.getAttribute('data-bse-file');
var INDEX = JSON.parse(document.getElementById('bse-index').textContent);
var pending = {};   // id -> {old,new}
var pairs = [];     // {node, entry}

// Pair DOM text nodes with source index entries, in document order.
(function pair(){
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function(n){
      var p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest('#bse-bar,script,style,svg,textarea')) return NodeFilter.FILTER_REJECT;
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
  // body-scope index entries: drop head-region entries by matching from the
  // first body text; entries and nodes must then align 1:1.
  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  var ei = 0;
  nodes.forEach(function(n){
    var j = ei;                                   // scan ahead without consuming
    while (j < INDEX.length && INDEX[j].text !== n.nodeValue) j++;
    if (j < INDEX.length) {
      pairs.push({node:n, entry:INDEX[j], parent:n.parentElement});
      ei = j + 1;
    }
  });
  nodes.forEach(function(n){
    if (!pairs.some(function(p){return p.node===n}))
      n.parentElement.classList.add('bse-unmapped');
  });
})();
// Recover pairs whose text node the browser replaced during editing:
// re-bind each parent's pairs, in order, to its current direct text nodes.
function rebind(scope){
  var byParent = new Map();
  pairs.forEach(function(p){
    if (scope && !scope.contains(p.parent)) return;
    if (!byParent.has(p.parent)) byParent.set(p.parent, []);
    byParent.get(p.parent).push(p);
  });
  byParent.forEach(function(plist, parent){
    if (!document.contains(parent)) return;
    if (plist.every(function(p){return document.contains(p.node) && p.node.parentElement===parent})) return;
    var texts = [].filter.call(parent.childNodes, function(c){
      return c.nodeType === 3 && c.nodeValue.trim();
    });
    if (texts.length === plist.length)
      plist.forEach(function(p, k){ p.node = texts[k]; });
  });
}

function blockOf(el){
  return el.closest('p,h1,h2,h3,h4,li,td,th,figcaption,blockquote,span,a,button,summary,label,div') || el;
}
var editing = null;
document.addEventListener('mouseover', function(e){
  if (editing || e.target.closest('#bse-bar')) return;
  document.querySelectorAll('.bse-hov').forEach(function(x){x.classList.remove('bse-hov')});
  var b = blockOf(e.target); if (b && b !== document.body) b.classList.add('bse-hov');
});
document.addEventListener('click', function(e){
  if (e.target.closest('#bse-bar')) return;
  e.preventDefault();
  var b = blockOf(e.target);
  if (!b || b === document.body) return;
  if (editing && editing !== b) endEdit();
  editing = b;
  b.classList.add('bse-edit');
  b.setAttribute('contenteditable', 'true');
  b.addEventListener('input', onType);
  b.focus();
}, true);
function onType(){ collect(); refresh(); }
function endEdit(){
  if (!editing) return;
  editing.removeEventListener('input', onType);
  editing.normalize();
  editing.removeAttribute('contenteditable');
  editing.classList.remove('bse-edit');
  collect();
  editing = null;
  refresh();
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') { endEdit(); }
  if ((e.metaKey||e.ctrlKey) && e.key === 's') { e.preventDefault(); endEdit(); save(); }
});
document.addEventListener('focusout', function(e){
  if (editing && !editing.contains(e.relatedTarget)) endEdit();
});

function collect(){
  rebind(editing);
  pairs.forEach(function(p){
    if (!document.contains(p.node)) return;   // unrecoverable (element deleted)
    var now = p.node.nodeValue;
    if (now !== p.entry.text) pending[p.entry.id] = {old:p.entry.text, text:now};
    else delete pending[p.entry.id];
  });
}
function count(){ return Object.keys(pending).length; }
function refresh(){
  var n = count();
  document.getElementById('bse-n').textContent = n ? n + ' unsaved edit' + (n>1?'s':'') : 'no unsaved edits';
  document.getElementById('bse-save').disabled = !n;
}
function api(path, body, cb){
  fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})
    .then(function(r){return r.json()}).then(cb)
    .catch(function(e){ msg('error: '+e); });
}
function msg(t){ document.getElementById('bse-msg').textContent = t; }
function save(){
  collect();
  if (!count()) return;
  var edits = Object.keys(pending).map(function(id){
    return {id:+id, old:pending[id].old, text:pending[id].text};
  });
  api('/save', {file:FILE, edits:edits}, function(r){
    if (r.ok) { msg('saved '+r.applied+' edit'+(r.applied>1?'s':'')+' to '+FILE); location.reload(); }
    else msg('save failed: '+r.error);
  });
}
function publish(){
  msg('publishing…');
  api('/publish', {}, function(r){
    msg(r.ok ? 'pushed ('+r.detail+'). Live in about a minute.' : 'publish failed: '+r.detail);
    gitStatus();
  });
}
function revert(){
  if (!confirm('Discard ALL unpublished saved changes to '+FILE+'?')) return;
  api('/revert', {file:FILE}, function(r){
    if (r.ok) location.reload(); else msg('revert failed: '+r.detail);
  });
}
function gitStatus(){
  fetch('/status').then(function(r){return r.json()}).then(function(s){
    document.getElementById('bse-git').textContent =
      s.dirty ? 'unpublished: ' + s.files.join(', ') : 'everything published';
    document.getElementById('bse-pub').disabled = !s.dirty;
  });
}
window.addEventListener('beforeunload', function(e){
  collect();
  if (count()) { e.preventDefault(); e.returnValue = ''; }
});
document.getElementById('bse-save').addEventListener('click', function(){ endEdit(); save(); });
document.getElementById('bse-pub').addEventListener('click', publish);
document.getElementById('bse-revert').addEventListener('click', revert);
refresh(); gitStatus();
})();
"""

BAR_CSS = """
#bse-bar{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;flex-wrap:wrap;
 gap:10px;align-items:center;background:#FBF8F0;color:#1E2B22;border-top:2px solid #1E2B22;
 padding:10px 16px;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif}
#bse-bar b{font-family:Raleway,-apple-system,sans-serif}
#bse-bar button{font:inherit;border:1px solid #1E2B22;background:none;color:#1E2B22;
 padding:6px 14px;cursor:pointer;border-radius:0}
#bse-bar button:hover:not(:disabled){background:#E0A526;border-color:#E0A526}
#bse-bar button:disabled{opacity:.4;cursor:default}
#bse-bar .sp{flex:1}
#bse-msg{color:#4A5A4E}
#bse-git{color:#4A5A4E}
.bse-hov{outline:2px dashed #E0A526;outline-offset:2px;cursor:text}
.bse-edit{outline:2px solid #3C6E47;outline-offset:2px;background:rgba(224,165,38,.08)}
.bse-unmapped{opacity:.55}
body{padding-bottom:70px !important}
/* edit mode runs with page scripts off; reveal script-gated sections so every
   tab's content is reachable, with a filename banner between them */
.page{display:block !important}
.page:before{content:"section: " attr(id);display:block;background:#1E2B22;color:#FBF8F0;
 font:600 12px/1 Raleway,-apple-system,sans-serif;letter-spacing:.12em;text-transform:uppercase;
 padding:8px 16px;position:sticky;top:0;z-index:9999}
"""


def edit_page(fname):
    path = os.path.join(ROOT, fname)
    src, nodes = build_index(path)
    served = neuter_scripts(src)
    inject = (
        '<style>%s</style>'
        '<script type="application/json" id="bse-index">%s</script>'
        '<div id="bse-bar"><b>Editing %s</b>'
        '<span id="bse-n"></span><span id="bse-msg"></span><span class="sp"></span>'
        '<span id="bse-git"></span>'
        '<button id="bse-save" disabled>Save (&#8984;S)</button>'
        '<button id="bse-pub">Publish</button>'
        '<button id="bse-revert">Discard saved</button>'
        '<a href="/" style="color:#24492F">pages</a></div>'
        '<script>%s</script>'
        % (BAR_CSS,
           json.dumps(nodes).replace("</", "<\\/"),
           html.escape(fname), CLIENT_JS)
    )
    served = served.replace("<html", '<html data-bse-file="%s"' % html.escape(fname), 1)
    if "</body>" in served:
        served = served.replace("</body>", inject + "</body>", 1)
    else:
        served += inject
    return served


def apply_edits(fname, edits):
    path = os.path.join(ROOT, fname)
    src, nodes = build_index(path)
    by_id = {n["id"]: n for n in nodes}
    todo = []
    for e in edits:
        n = by_id.get(e["id"])
        if n is None or n["text"] != e["old"]:
            return None, "page changed on disk; reload and re-edit"
        todo.append((n["start"], n["end"], html.escape(e["text"], quote=False)))
    todo.sort(reverse=True)
    for start, end, new in todo:
        src = src[:start] + new + src[end:]
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    return len(todo), None


def picker():
    pages = sorted(f for f in os.listdir(ROOT)
                   if f.endswith(".html") and f != "404.html")
    _, status = run_git("status", "--porcelain")
    rows = "".join(
        '<li><a href="/edit/%s">%s</a>%s</li>'
        % (p, p, ' <em>unpublished changes</em>' if p in status else "")
        for p in pages)
    return """<!DOCTYPE html><meta charset="utf-8"><title>Site Editor</title>
<style>body{font:16px/1.6 -apple-system,sans-serif;background:#FBF8F0;color:#1E2B22;
max-width:640px;margin:60px auto;padding:0 24px}
h1{font-family:Raleway,sans-serif}li{margin:8px 0}
a{color:#24492F}em{color:#C4623C;font-style:normal;font-size:.85em}</style>
<h1>Site Editor</h1>
<p>Pick a page, click any text on it, type, save, publish. Dynamic content
(charts, the blog list) is hidden in edit mode on purpose.</p>
<ul>%s</ul>""" % rows


class H(BaseHTTPRequestHandler):
    def _send(self, body, ctype="text/html; charset=utf-8", code=200):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj), "application/json", code)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/":
            return self._send(picker())
        if self.path == "/status":
            _, out = run_git("status", "--porcelain")
            files = [l[3:] for l in out.splitlines() if l]
            return self._json({"dirty": bool(files), "files": files})
        if self.path.startswith("/edit/"):
            fname = os.path.basename(self.path[len("/edit/"):])
            if fname.endswith(".html") and os.path.isfile(os.path.join(ROOT, fname)):
                return self._send(edit_page(fname))
            return self._send("not found", code=404)
        # static assets for the edited page (images, fonts, favicon)
        fpath = os.path.normpath(os.path.join(ROOT, self.path.lstrip("/")))
        if fpath.startswith(ROOT) and os.path.isfile(fpath):
            ext = os.path.splitext(fpath)[1].lower()
            ctypes = {".png": "image/png", ".svg": "image/svg+xml",
                      ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                      ".css": "text/css", ".pdf": "application/pdf",
                      ".json": "application/json", ".woff2": "font/woff2"}
            with open(fpath, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctypes.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._send("not found", code=404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json({"ok": False, "error": "bad json"}, 400)
        if self.path == "/save":
            fname = os.path.basename(body.get("file", ""))
            if not fname.endswith(".html") or not os.path.isfile(os.path.join(ROOT, fname)):
                return self._json({"ok": False, "error": "bad file"}, 400)
            n, err = apply_edits(fname, body.get("edits", []))
            if err:
                return self._json({"ok": False, "error": err}, 409)
            return self._json({"ok": True, "applied": n})
        if self.path == "/publish":
            run_git("add", "-A")
            code, out = run_git("commit", "-m", "content: inline edits via site editor")
            if code != 0 and "nothing to commit" not in out:
                return self._json({"ok": False, "detail": out})
            code, out = run_git("push")
            return self._json({"ok": code == 0, "detail": out.splitlines()[-1] if out else "pushed"})
        if self.path == "/revert":
            fname = os.path.basename(body.get("file", ""))
            code, out = run_git("checkout", "--", fname)
            return self._json({"ok": code == 0, "detail": out})
        self._json({"ok": False, "error": "unknown"}, 404)


def main():
    addr = ("127.0.0.1", PORT)
    httpd = ThreadingHTTPServer(addr, H)
    url = "http://127.0.0.1:%d/" % PORT
    print("Site Editor serving %s at %s" % (ROOT, url))
    if "--no-open" not in sys.argv:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
