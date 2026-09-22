import type { LifeEvent } from '../../contracts/api.ts';
/** Missing dates stay in the event list; missing ratings interrupt the line, never become zero. */
export function curvePoints(events: LifeEvent[]) {
  const dated = events
    .filter((e) => e.date !== null)
    .map((event) => ({
      event,
      time: Date.parse(
        event.date!.length === 4
          ? event.date + '-01-01'
          : event.date!.length === 7
            ? event.date + '-01'
            : event.date!,
      ),
    }))
    .sort((a, b) => a.time - b.time);
  const min = dated[0]?.time ?? 0,
    max = dated.at(-1)?.time ?? 0;
  return dated.map(({ event, time }) => ({
    event,
    x: max === min ? 160 : 24 + ((time - min) / (max - min)) * 272,
    y: event.feeling === null ? null : 70 - event.feeling * 10,
  }));
}
