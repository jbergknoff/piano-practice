import { parseMidi } from "midi-file";
import { useState } from "preact/hooks";

export function App() {
  const [midiJson, setMidiJson] = useState<object | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setMidiJson(null);

    file.arrayBuffer().then((buffer) => {
      try {
        const parsed = parseMidi(new Uint8Array(buffer));
        setMidiJson(parsed);
      } catch (err) {
        setError(String(err));
      }
    });
  }

  return (
    <div>
      <h1>MIDI Inspector</h1>
      <input type="file" accept=".mid,.midi" onChange={handleFile} />
      {fileName && <p>File: {fileName}</p>}
      {error && <p style="color: red">{error}</p>}
      {midiJson && (
        <pre style="white-space: pre-wrap; word-break: break-all">
          {JSON.stringify(midiJson, null, 2)}
        </pre>
      )}
    </div>
  );
}
