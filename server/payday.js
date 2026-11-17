import { getSettings } from './settings.js';
import { addDays, dowOf, isDate, today as todayIn } from './time.js';

// Режим выдачи зарплаты:
//   week  — раз в неделю в выбранный день недели;
//   twice — два раза в месяц (например 1 и 15 числа);
//   month — раз в месяц в выбранное число (если в месяце меньше дней — в последний день);
//   dates — даты, выбранные вручную в календаре;
//   none  — без расписания.
export const PAY_MODES = ['none', 'week', 'twice', 'month', 'dates'];
const WD = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];

const lastDay = (date) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const dom = (date) => Number(date.slice(8));
// Число месяца с учётом коротких месяцев: «31 число» в ноябре — это 30-е.
const isMonthDay = (date, n) => dom(date) === Math.min(n, lastDay(date));

export function parseDates(s) {
  return [...new Set(String(s || '').split(',').map((x) => x.trim()).filter(isDate))].sort();
}

export function isPayday(date, s = getSettings()) {
  switch (s.payMode) {
    case 'week':
      return dowOf(date) === s.payWeekday;
    case 'twice':
      return isMonthDay(date, s.payMonthDay) || isMonthDay(date, s.payMonthDay2);
    case 'month':
      return isMonthDay(date, s.payMonthDay);
    case 'dates':
      return parseDates(s.payDates).includes(date);
    default:
      return false;
  }
}

export function paydayText(s = getSettings()) {
  switch (s.payMode) {
    case 'week':
      return `раз в неделю, в ${WD[s.payWeekday]}`;
    case 'twice':
      return `два раза в месяц: ${Math.min(s.payMonthDay, s.payMonthDay2)} и ${Math.max(s.payMonthDay, s.payMonthDay2)} числа`;
    case 'month':
      return `раз в месяц, ${s.payMonthDay} числа`;
    case 'dates':
      return 'по датам из календаря';
    default:
      return 'расписание не задано';
  }
}

// Ближайшие дни выдачи начиная с сегодня и последний прошедший.
export function paydayInfo(count = 4) {
  const s = getSettings();
  const t = todayIn(s.tz);
  const next = [];
  if (s.payMode !== 'none') {
    for (let d = t, i = 0; i < 400 && next.length < count; d = addDays(d, 1), i++) if (isPayday(d, s)) next.push(d);
  }
  let prev = null;
  if (s.payMode !== 'none') {
    for (let d = addDays(t, -1), i = 0; i < 400; d = addDays(d, -1), i++)
      if (isPayday(d, s)) {
        prev = d;
        break;
      }
  }
  return {
    mode: s.payMode,
    weekday: s.payWeekday,
    monthDay: s.payMonthDay,
    monthDay2: s.payMonthDay2,
    dates: parseDates(s.payDates),
    text: paydayText(s),
    today: t,
    isToday: next[0] === t,
    next,
    prev,
  };
}
