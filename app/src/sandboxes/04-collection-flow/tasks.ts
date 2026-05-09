// Sandbox 04: Collection flow — task catalog (English).
//
// Task definitions used for Physical AI training-data collection. Each task carries:
//   - emoji icon (kept — easy task recognition during selection)
//   - name (English)
//   - startCondition / endCondition: human-readable, sent to VLM as the judgment criterion
//
// Asset overlays (optional, user places later):
//   assets/sandbox-04/tasks/<id>/start.png    — start-condition illustration
//   assets/sandbox-04/tasks/<id>/end.png      — end-condition illustration

import type { ImageSourcePropType } from 'react-native';

export interface TaskDef {
  id: string;
  name: string;
  emoji: string;
  /** Start condition — sent to VLM verbatim as judgment criterion */
  startCondition: string;
  /** End condition */
  endCondition: string;
  /** Optional illustrations (placed later via require()) */
  startIllustration?: ImageSourcePropType;
  endIllustration?: ImageSourcePropType;
}

export const TASKS: TaskDef[] = [
  {
    id: 'fold-laundry',
    name: 'Fold laundry',
    emoji: '🧺',
    startCondition: 'Unfolded laundry is gathered in a single pile, and both hands are visible in frame.',
    endCondition: 'All items of laundry are folded and laid out neatly.',
    startIllustration: require('../../../assets/sandbox-04/tasks/fold-laundry/start.jpg'),
    endIllustration: require('../../../assets/sandbox-04/tasks/fold-laundry/end.jpg'),
  },
  {
    id: 'wash-dishes',
    name: 'Wash dishes',
    emoji: '🍽️',
    startCondition: 'Dirty dishes are in the sink, and both hands are visible in frame.',
    endCondition: 'Dishes are washed and arranged on the drying rack.',
    startIllustration: require('../../../assets/sandbox-04/tasks/wash-dishes/start.jpg'),
    endIllustration: require('../../../assets/sandbox-04/tasks/wash-dishes/end.jpg'),
  },
  {
    id: 'cook-pasta',
    name: 'Cook pasta',
    emoji: '🍝',
    startCondition: 'Pasta ingredients (dry pasta, sauce) are laid out, and both hands are visible in frame.',
    endCondition: 'Cooked pasta is plated.',
    startIllustration: require('../../../assets/sandbox-04/tasks/cook-pasta/start.jpg'),
    endIllustration: require('../../../assets/sandbox-04/tasks/cook-pasta/end.jpg'),
  },
  {
    id: 'vacuum-floor',
    name: 'Vacuum floor',
    emoji: '🧹',
    startCondition: 'The floor has visible dust or debris; one hand holds the vacuum handle and both hands are visible in frame.',
    endCondition: 'The floor is clean.',
    startIllustration: require('../../../assets/sandbox-04/tasks/vacuum-floor/start.jpg'),
    endIllustration: require('../../../assets/sandbox-04/tasks/vacuum-floor/end.jpg'),
  },
  {
    id: 'make-bed',
    name: 'Make the bed',
    emoji: '🛏️',
    startCondition: 'Sheets, blanket, and pillows are messy or disheveled, and both hands are visible in frame.',
    endCondition: 'Sheets, blanket, and pillows are arranged tidily.',
    startIllustration: require('../../../assets/sandbox-04/tasks/make-bed/start.jpg'),
    endIllustration: require('../../../assets/sandbox-04/tasks/make-bed/end.jpg'),
  },
];

export function findTask(id: string): TaskDef | undefined {
  return TASKS.find((t) => t.id === id);
}
