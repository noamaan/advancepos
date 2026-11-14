import { missingKeys } from '../lib/firebase';

/** Shown instead of the app until Firebase env vars exist — runs anywhere. */
export function Setup() {
  return (
    <div className="setup-wrap">
      <div className="card setup-card">
        <h1>🍺 AdvancePOS setup</h1>
        <p>The app is compiled and ready, but it needs your <b>Firebase</b> project keys before it can start. Nothing is hardcoded — you provide the config once:</p>
        <ol>
          <li>Go to <b>console.firebase.google.com</b> → <i>Create project</i> (name e.g. <code>advancepos</code>).</li>
          <li>Enable <b>Build → Authentication → Sign-in method → Email/Password</b>.</li>
          <li>Create <b>Build → Firestore Database</b> (production mode) and <b>Build → Storage</b>.</li>
          <li>Project settings → <i>Your apps</i> → web <code>&lt;/&gt;</code> → copy the config values.</li>
          <li>Create a file <code>.env</code> next to <code>package.json</code> with these variables (see <code>.env.example</code>):</li>
        </ol>
        <pre className="code-block">{missingKeys.map((k) => `${k}=\n`).join('')}</pre>
        <p>Then restart <code>npm run dev</code> (or rebuild for deploy). All remaining setup (security rules, first developer account, optional payment gateway) is documented in <code>README.md</code>.</p>
      </div>
    </div>
  );
}
