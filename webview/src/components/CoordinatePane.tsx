export function CoordinatePane() {
  return (
    <div className="pf-coordinate">
      <div className="pf-coordinate__col">
        <h3 className="pf-coordinate__h">Session</h3>
        <p className="pf-coordinate__p">Presence, locks, and review gates will attach here.</p>
        <ul className="pf-coordinate__list">
          <li>Designer — viewing Plan · Core</li>
          <li>Engineer — editing Program · Calendar.java</li>
        </ul>
      </div>
      <div className="pf-coordinate__col pf-coordinate__col--timeline">
        <h3 className="pf-coordinate__h">Timeline</h3>
        <div className="pf-coordinate__steps">
          <div className="pf-coordinate__step">Decision recorded — UTC storage</div>
          <div className="pf-coordinate__step">Prompt linked — overlap policy</div>
          <div className="pf-coordinate__step">Feature reordered — local Core</div>
        </div>
      </div>
    </div>
  );
}
