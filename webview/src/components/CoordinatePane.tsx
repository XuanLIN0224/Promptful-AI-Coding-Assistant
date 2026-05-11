export function CoordinatePane() {
  return (
    <div className="pf-coordinate">
      <div className="pf-coordinate__col">
        <h3 className="pf-coordinate__h">Session</h3>
        <p className="pf-coordinate__p">Shared planning state, prompt traceability, and context review sit here.</p>
        <ul className="pf-coordinate__list">
          <li>Designer - reviewing cluster structure</li>
          <li>Engineer - checking starter code highlights</li>
          <li>Client note - financial data requires careful access boundaries</li>
        </ul>
      </div>
      <div className="pf-coordinate__col pf-coordinate__col--timeline">
        <h3 className="pf-coordinate__h">Timeline</h3>
        <div className="pf-coordinate__steps">
          <div className="pf-coordinate__step">Decision recorded - equal split as default</div>
          <div className="pf-coordinate__step">Context updated - groups and budgeting separated</div>
          <div className="pf-coordinate__step">Security cluster added - access and audit suggested</div>
        </div>
      </div>
    </div>
  );
}
