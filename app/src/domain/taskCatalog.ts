// 撮影対象家事タスクのカタログ。
// SPECS_JA §2.2: 運営が事前定義する有限のタスクリスト。
//
// 各 task は:
//   - id           ステーブルなキー (URL-safe)
//   - name         表示名 (英語)
//   - emoji        簡易アイコン (リスト表示や empty-state 用)
//   - blurb        Job カードの 1-2 行説明 (Timee カード風)
//   - startCondition / endCondition  VLM gate に逐語で渡される判定基準
//   - illustration 縦長カードの主役絵 (Gemini 生成、navy outline + emerald accent)
//   - durationMin  目安所要時間 (供給者向け)
//   - reward       1 clip あたりの推定報酬 (USDC、表示用)。
//                  目安: 平均所要時間 × $10/hr。実値は需要次第。
//   - intensity    両手作業の負荷感 (LIGHT / MEDIUM / HEAVY)

import type { ImageSourcePropType } from 'react-native';

export type TaskIntensity = 'LIGHT' | 'MEDIUM' | 'HEAVY';

// 撮影時の端末向き。 task ごとに固定。
// portrait  = 縦長 mount。 体の真下 / 足元 / 手元の縦長物 (vacuum / 読書 / 階段) 向き。
// landscape = 横長 mount。 目の前で水平に広がる作業 (調理 / 片付け / 組み立て) 向き。
// 物理 LEFT / RIGHT (= mount を左右どちらに付けるか) は user 任意、 OS の orientation
// listener で実値を取得して native に渡す。 LEFT / RIGHT 区別は TaskDef に持たない。
export type TaskOrientation = 'portrait' | 'landscape';

export interface TaskDef {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  startCondition: string;
  endCondition: string;
  illustration: ImageSourcePropType;
  durationMin: [number, number]; // [min, max]
  reward: number; // USDC
  intensity: TaskIntensity;
  orientation: TaskOrientation;
}

export const TASKS: TaskDef[] = [
  {
    id: 'fold-laundry',
    name: 'Fold laundry',
    emoji: '🧺',
    blurb: 'Fold any unfolded clothes into a neat stack — one item or many, both hands working.',
    // 枚数に依存しない判定: 数えれば 1 枚でも OK にする。
    // VLM が「一部だけ」「全部ではない」で減点してくる傾向があるため明示的に exempt。
    startCondition:
      'At least one piece of unfolded laundry is visible in the frame, and both hands are visible. Item count does not matter — one item is enough.',
    endCondition:
      'The previously unfolded laundry has been folded neatly. Item count is irrelevant — even a single folded item satisfies this condition as long as it is folded cleanly.',
    illustration: require('../../assets/tasks/fold-laundry/card.png'),
    durationMin: [5, 10],
    reward: 1.2, // ~7.5 min × $10/hr
    intensity: 'LIGHT',
    orientation: 'landscape',
  },
  {
    id: 'wash-dishes',
    name: 'Wash dishes',
    emoji: '🍽️',
    blurb: 'Run the faucet, sponge the plates, set them clean on the drying rack.',
    startCondition: 'Dirty dishes are in the sink, and both hands are visible in frame.',
    endCondition: 'Dishes are washed and arranged on the drying rack.',
    illustration: require('../../assets/tasks/wash-dishes/card.png'),
    durationMin: [5, 12],
    reward: 1.4, // ~8.5 min × $10/hr
    intensity: 'MEDIUM',
    orientation: 'landscape',
  },
  {
    id: 'cook-pasta',
    name: 'Cook pasta',
    emoji: '🍝',
    blurb: 'Boil water, cook pasta, plate it. A short kitchen sequence.',
    startCondition: 'Pasta ingredients (dry pasta, sauce) are laid out, and both hands are visible in frame.',
    endCondition: 'Cooked pasta is plated.',
    illustration: require('../../assets/tasks/cook-pasta/card.png'),
    durationMin: [10, 20],
    reward: 2.5, // ~15 min × $10/hr
    intensity: 'MEDIUM',
    orientation: 'landscape',
  },
  {
    id: 'vacuum-floor',
    name: 'Vacuum floor',
    emoji: '🧹',
    blurb: 'Pick up the vacuum and clear visible dust from the floor.',
    startCondition: 'The floor has visible dust or debris; one hand holds the vacuum handle and both hands are visible in frame.',
    endCondition: 'The floor is clean.',
    illustration: require('../../assets/tasks/vacuum-floor/card.png'),
    durationMin: [5, 12],
    reward: 1.4, // ~8.5 min × $10/hr
    intensity: 'LIGHT',
    orientation: 'portrait',
  },
  {
    id: 'make-bed',
    name: 'Make the bed',
    emoji: '🛏️',
    blurb: 'Smooth the sheet, fold the quilt, set the pillows.',
    startCondition: 'Sheets, blanket, and pillows are messy or disheveled, and both hands are visible in frame.',
    endCondition: 'Sheets, blanket, and pillows are arranged tidily.',
    illustration: require('../../assets/tasks/make-bed/card.png'),
    durationMin: [3, 6],
    reward: 0.8, // ~4.5 min × $10/hr
    intensity: 'LIGHT',
    orientation: 'landscape',
  },
];

export function findTask(id: string): TaskDef | undefined {
  return TASKS.find((t) => t.id === id);
}
