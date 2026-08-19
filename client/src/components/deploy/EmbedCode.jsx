import React from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';

export default function EmbedCode({ chatUrl, onCopy, copied }) {
  const iframeCode = `<iframe src="${chatUrl}" width="400" height="600" style="border:none; border-radius:8px;"></iframe>`;
  
  const scriptCode = `<div id="rag-mentor-chat"></div>
<script>
  (function() {
    const iframe = document.createElement('iframe');
    iframe.src = "${chatUrl}";
    iframe.width = "400";
    iframe.height = "600";
    iframe.style.border = "none";
    iframe.style.borderRadius = "8px";
    document.getElementById('rag-mentor-chat').appendChild(iframe);
  })();
</script>`;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">IFrame Embed</h3>
          <Button variant="outline" size="sm" onClick={() => onCopy(iframeCode)}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto">
          {iframeCode}
        </pre>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">JavaScript Snippet</h3>
          <Button variant="outline" size="sm" onClick={() => onCopy(scriptCode)}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto">
          {scriptCode}
        </pre>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-sm mb-2">How to use:</h4>
        <ol className="text-sm space-y-1 list-decimal list-inside">
          <li>Copy one of the code snippets above</li>
          <li>Paste it into your website's HTML</li>
          <li>Your chatbot will appear automatically</li>
        </ol>
      </div>
    </div>
  );
}