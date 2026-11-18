// 18条人工编写的工程虚构输入与假答案；用于连通性和边界验证，不代表真实金标或准确率。
import { workbook } from './io.mjs';
import { EC_HEADERS } from './ecommerce-schema.mjs';

const standardRow = () => [
  '工程虚构样例；非正式制度，人工列是假答案，不是真实金标', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '测试：北京时间；连续自然时间含晚间周末，超过24小时Fail，恰好24小时Pass；无效时间待判定。',
  '测试：明显拼写、语法、标点、表情、通顺、歧义问题任一成立Fail。',
  '测试：未针对问题诉求夸赞、完全无关、同批次同管理员>=3条重复或高度相似，任一成立Fail。',
  '测试：至少3个操作排查解决步骤且未按1、2、3编号时Fail，否则Pass。',
  '测试：实际公开回复披露个人信息Fail；输入订单号本身不等于泄露。',
  '仅工程假答案，非真实效果验证', '所有姓名、商品、管理员及业务情景均为虚构；邮箱使用example.com。',
];
const base = (key, index, changes = {}, answers = ['Pass','Pass','Pass','Pass','Pass'], problem = '') => {
  const raw = ['虚构欧洲','2026-10','虚构西欧','虚构国家',`00000000000000000000${String(index).padStart(3, '0')}`,`00000987654321012345${String(index).padStart(3, '0')}`, '000000012345678901234567','虚构云杉耳机',
    '这款虚构耳机佩戴很舒适。','感谢您认可虚构云杉耳机的佩戴舒适度，祝您使用愉快。','5',`虚构管理员-${index}`,'2026-10-30 10:00:00','2026-10-30 11:00:00',
    `${key}（工程虚构用例）`, ...answers, answers.includes('Fail') ? 'Fail' : answers.includes('Unable') ? 'Unable' : 'Pass', `工程假答案，非真实金标。${problem}`];
  for (const [column, value] of Object.entries(changes)) raw[Number(column)] = value;
  return raw;
};

export async function createEcommerceSample() {
  const duplicate = '感谢您对虚构云杉耳机音质的认可，祝您使用愉快。';
  const rows = [
    base('SAMPLE-NORMAL', 1),
    base('SAMPLE-24H-BOUNDARY', 2, { 12: '2026-10-30 20:00:00', 13: '2026-10-31 20:00:00' }),
    base('SAMPLE-OVER-24H', 3, { 12: '2026-10-30 20:00:00', 13: '2026-10-31 20:00:01' }, ['Fail','Pass','Pass','Pass','Pass'], '连续24小时加1秒，含夜间和周末。'),
    ...[1, 2, 3].map((number, offset) => base(`SAMPLE-DUPLICATE-${number}`, offset + 4, { 8: ['音质很清楚，听音乐满意。','声音清晰，虚构耳机不错。','耳机音质让我很满意。'][offset], 9: duplicate, 11: '虚构重复组管理员' }, ['Pass','Pass','Fail','Pass','Pass'], '本批次同管理员3条完全重复回复。')),
    base('SAMPLE-DIFFERENT-AGENT-1', 7, { 8: '虚构耳机音质很好。', 9: duplicate, 11: '虚构不同管理员甲' }),
    base('SAMPLE-DIFFERENT-AGENT-2', 8, { 8: '虚构耳机音质很好。', 9: duplicate, 11: '虚构不同管理员乙' }),
    base('SAMPLE-INVALID-TIME', 9, { 12: '2026-02-30 10:00:00' }, ['Unable','Pass','Pass','Pass','Pass'], '原评论时间日历无效，不能补当前时间。'),
    base('SAMPLE-MISSING-TIME', 10, { 12: '' }, ['Unable','Pass','Pass','Pass','Pass'], '缺评论时间。'),
    base('SAMPLE-NO-REPLY', 11, { 9: '', 13: '' }, ['Unable','Unable','Unable','Unable','Unable'], '缺真实回复，不能造一轮客服消息。'),
    base('SAMPLE-STEPS-UNNUMBERED', 12, { 8: '虚构耳机无法连接手机，请问怎么排查？', 9: '请先打开手机蓝牙。\n然后将虚构耳机放回盒内并重新取出。\n最后在手机设备列表中重新配对虚构耳机。', 10: '2' }, ['Pass','Pass','Pass','Fail','Pass'], '3个明确操作步骤未编号。'),
    base('SAMPLE-STEPS-NUMBERED', 13, { 8: '虚构耳机无法连接手机，请问怎么排查？', 9: '1. 打开手机蓝牙。\n2. 将虚构耳机放回盒内并重新取出。\n3. 在手机设备列表中重新配对虚构耳机。', 10: '2' }),
    base('SAMPLE-PRIVACY', 14, { 8: '登记的联系邮箱需要在哪里修改？', 9: '虚构林晓，您当前登记的邮箱是fictional.lin@example.com，请进入账号资料页修改。', 10: '3' }, ['Pass','Pass','Pass','Pass','Fail'], '实际公开回复含虚构姓名和联系邮箱；仅用于测试识别链路。'),
    base('SAMPLE-TEXT', 15, { 8: 'The fictional headphones sound clear. Thank you.', 9: 'We is very glad you likes the sound of these fictional headphones.' }, ['Pass','Fail','Pass','Pass','Pass'], '工程明显英语主谓语法错误。'),
    base('SAMPLE-UNRELATED', 16, { 8: '我的虚构耳机订单还未发货，何时处理？', 9: '今天分享一道番茄炒蛋的做法，祝您用餐愉快。', 10: '1' }, ['Pass','Pass','Fail','Pass','Pass'], '回复与发货诉求完全无关。'),
    base('SAMPLE-NO-COMMENT', 17, { 8: '' }, ['Pass','Pass','Unable','Pass','Pass'], '原评论缺失，无法判断针对性。'),
    base('SAMPLE-REVERSED-TIME', 18, { 12: '2026-10-30 10:00:00', 13: '2026-10-29 11:00:00' }, ['Unable','Pass','Pass','Pass','Pass'], '首次回复早于评论，时效无法判定。'),
  ];
  return workbook([{ name: 'Sheet4', headers: [...EC_HEADERS], rows: [standardRow(), ...rows] }]);
}
