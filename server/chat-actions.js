const generationCue = /(?:生成|出图|做(?:一|两|二|三|四|五|六|七|八|九|十|\d)|制作|设计)/i;
const designCue =
  /(?:图片|款|套|系列|服装|穿搭|造型|男款|女款|男女|情侣|街头|休闲|运动|春夏|秋冬|趋势|模特|logo|品牌)/i;
const executionCue = /(?:直接|立即|马上|现在)?(?:开始|启动|执行|发起|生成|出图|制作|设计)/i;
const selectionCue = /(?:随便|任意|已有|现有|历史|项目内|不用参考图|无需参考图|调用)/i;
const questionCue = /(?:为什么|为何|原因|失败|不能|无法|没有|怎么|如何|是否|能否|能不能)/i;
const imperativeCue = /(?:帮我|请|给我|直接|立即|马上|开始|启动|执行|发起)/i;
const resumeCue =
  /(?:继续(?:未完成|上次|之前|这个|该)?(?:的)?(?:任务|生成)|恢复(?:任务|生成)?|重试|重新开始(?:任务|生成)?|再次执行)/i;
const pureControlCue =
  /^(?:直接|立即|马上|现在)?(?:开始|启动|执行|发起|继续|重试|恢复|重新开始)(?:一下|吧|任务|生成|未完成任务)*[。！! ]*$/i;

const chineseDigit = new Map([
  ['一', 1],
  ['二', 2],
  ['两', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
  ['十', 10],
]);

const parseCountToken = (token) => {
  if (/^\d+$/.test(token)) return Number(token);
  if (chineseDigit.has(token)) return chineseDigit.get(token);
  if (token.startsWith('十')) return 10 + (chineseDigit.get(token.slice(1)) || 0);
  if (token.endsWith('十')) return (chineseDigit.get(token.slice(0, -1)) || 0) * 10;
  const [tens, ones] = token.split('十');
  return (chineseDigit.get(tens) || 0) * 10 + (chineseDigit.get(ones) || 0);
};

export const requestedImageCount = (messages) => {
  const users = messages
    .filter((message) => message?.role === 'user')
    .slice(-6)
    .reverse();
  for (const message of users) {
    const matches = [
      ...String(message.content || '').matchAll(
        /([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:张|款|套|个)/g,
      ),
    ];
    if (!matches.length) continue;
    const count = parseCountToken(matches.at(-1)[1]);
    if (Number.isInteger(count)) return Math.max(1, Math.min(12, count));
  }
  return 1;
};

const seriesInstruction = (users) => {
  const recent = users.slice(-6);
  let anchor = recent.length - 1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const content = String(recent[index]?.content || '');
    if (generationCue.test(content) && designCue.test(content)) {
      anchor = index;
      break;
    }
  }
  const relevant = recent
    .slice(anchor)
    .map((message) => String(message.content || '').trim())
    .filter(Boolean)
    .filter((content) => !pureControlCue.test(content))
    .filter(
      (content) =>
        generationCue.test(content) || designCue.test(content) || selectionCue.test(content),
    );
  return [...new Set(relevant)].slice(-4).join('；').slice(0, 4000);
};

export function inferChatAction(messages = []) {
  const users = messages.filter(
    (message) => message?.role === 'user' && typeof message.content === 'string',
  );
  const current = users.at(-1)?.content.trim() || '';
  if (!current) return { type: 'none' };
  if (resumeCue.test(current)) return { type: 'resume' };

  const recent = users.slice(-6);
  const previousText = recent
    .slice(0, -1)
    .map((message) => message.content)
    .join(' ');
  const contextText = recent.map((message) => message.content).join(' ');
  const asksQuestion = questionCue.test(current) && !imperativeCue.test(current);
  const explicitGeneration = generationCue.test(current) && designCue.test(contextText);
  const followsGeneration =
    (executionCue.test(current) || selectionCue.test(current)) &&
    generationCue.test(previousText) &&
    designCue.test(previousText);
  if (!asksQuestion && (explicitGeneration || followsGeneration))
    return {
      type: 'series',
      count: requestedImageCount(recent),
      instruction: seriesInstruction(recent) || current,
    };
  return { type: 'none' };
}
