import {analyze, greedyPlan, routeToTarget, managementNetwork} from './model.mjs';
import {loadLandMask} from './land-mask.mjs';

self.onmessage = async ({data}) => {
  const {id, bounds, years, generations, budget, threshold} = data;
  try {
    await loadLandMask();
    const analysis = analyze(bounds, {years, generations});
    const plan = greedyPlan(analysis.cells, budget, threshold);
    const route = routeToTarget(analysis, plan.selected[0]);
    const network = managementNetwork(analysis.centers.filter(center => center.visible));
    self.postMessage({id, result: {analysis, plan, route, network}});
  } catch (error) {
    self.postMessage({id, error: error.message});
  }
};
