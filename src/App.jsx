import Doc from '../content/doc.mdx';
import { components } from './components.jsx';
import { EditorShell } from './editor.jsx';

export default function App() {
  return (
    <>
      <main>
        <Doc components={components} />
      </main>
      {import.meta.env.DEV && <EditorShell />}
    </>
  );
}
