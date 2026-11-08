import { Provider } from 'jotai';
import { DataLabView } from '~/components/DataLab';

/**
 * Route shell for Data Lab. A per-mount Jotai store keeps the view's chart,
 * sort, filter and derived-series state local to the page. No data-service is
 * wired yet, so the view renders its own empty state — passing a `dataset` or a
 * `loadData` loader here is all a real backend needs.
 */
export default function DataLabRoute() {
  return (
    <Provider>
      <DataLabView />
    </Provider>
  );
}
