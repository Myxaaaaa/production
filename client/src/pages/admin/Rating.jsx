import { useApi, usePeriod, periodQuery } from '../../lib.js';
import { ErrorBox, Loading, PageHead, PeriodPicker } from '../../components/ui.jsx';
import { KpdRating } from '../../components/rating.jsx';

export function AdminRating() {
  const [period, setPeriod] = usePeriod('admin-rating');
  const { data, error, loading, reload } = useApi(`/admin/rating?${periodQuery(period)}`, { refreshMs: 60000 });
  return (
    <div className="page">
      <PageHead title="Рейтинг КПД" subtitle="Кто работает эффективнее всех — по прибыли, скорости, отдаче и стабильности">
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data ? <KpdRating data={data} /> : null}
    </div>
  );
}
