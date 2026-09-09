import {analyze, greedyPlan, routeToTarget, primEdges} from './model.mjs';

self.onmessage = ({data}) => {
  const {id, bounds, years, generations, budget, threshold} = data;
  try {
    const analysis = analyze(bounds, {years, generations});
    const plan = greedyPlan(analysis.cells, budget, threshold);
    const route = routeToTarget(analysis, plan.selected[0]);
    const network = primEdges(analysis.centers.filter(center => center.visible));
    self.postMessage({id, result: {analysis, plan, route, network}});
  } catch (error) {
    self.postMessage({id, error: error.message});
  }
};
