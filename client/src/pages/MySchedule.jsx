import { Link } from 'react-router-dom';
import { ScheduleCalendar } from '../components/schedule.jsx';
import { PageHead } from '../components/ui.jsx';

export function MySchedulePage() {
  return (
    <div className="page">
      <PageHead title="Мой график" subtitle="Смены и выходные ставит администратор" />
      <div className="card">
        <ScheduleCalendar readOnly />
      </div>
      <p className="muted small">
        ⏳ — смена прошла, а прибыль не заполнена: оклад за неё ещё не начислен. Заполнить можно на <Link to="/">главной</Link>.
      </p>
    </div>
  );
}
