/**
 * 场景值 → 渠道映射（dev_behavior_phase3/01 §4.2，phase4/04 §1.5 按官方表修正支付宝 / 抖音）。随事件带 `$scene`（原值）与 `$scene_channel`；服务端可按 `$scene` 重算。
 * 与 packages/shared/src/mp-scenes.ts 是同一份代码（SDK 独立发布，不能依赖 shared），shared 单测会对比两份结果，改一边要同步另一边。
 * 微信场景值文档：https://developers.weixin.qq.com/miniprogram/dev/reference/scene-list.html
 */
export type SceneChannel = 'direct' | 'search' | 'social' | 'content' | 'scan' | 'notification' | 'ad' | 'mp_link' | 'app' | 'history' | 'other';
export const SCENE_CHANNELS: readonly SceneChannel[] = ['direct', 'search', 'social', 'content', 'scan', 'notification', 'ad', 'mp_link', 'app', 'history', 'other'];

/** 微信：按区间 + 精确值 */
const WX_EXACT: Record<number, SceneChannel> = {
  1001: 'direct', // 发现栏小程序主入口
  1005: 'search', // 顶部搜索框
  1006: 'search', // 搜索结果页
  1007: 'social', // 单人聊天会话
  1008: 'social', // 群聊会话
  1011: 'scan', // 扫描二维码
  1012: 'scan', // 长按图片识别
  1013: 'scan', // 扫描手机相册
  1014: 'notification', // 小程序模板消息
  1017: 'ad', // 前往小程序体验版
  1019: 'direct', // 微信钱包
  1020: 'mp_link', // 公众号 profile 页
  1022: 'social', // 聊天顶部置顶
  1023: 'direct', // 安卓桌面图标
  1024: 'direct', // 小程序 profile 页
  1025: 'scan', // 扫描一维码
  1026: 'direct', // 附近小程序
  1027: 'search', // 顶部搜索框搜索结果页「使用过的小程序」
  1028: 'direct', // 我的卡包
  1031: 'scan', // 长按图片识别一维码
  1032: 'scan', // 扫描手机相册一维码
  1034: 'notification', // 微信支付完成页
  1035: 'mp_link', // 公众号自定义菜单
  1036: 'app', // App 分享消息卡片
  1037: 'mp_link', // 小程序打开小程序
  1038: 'mp_link', // 从另一个小程序返回
  1039: 'direct', // 摇电视
  1042: 'search', // 添加好友搜索框
  1043: 'mp_link', // 公众号模板消息
  1044: 'social', // 带 shareTicket 的分享
  1045: 'ad', // 朋友圈广告
  1046: 'ad', // 朋友圈广告详情页
  1047: 'scan', // 扫描小程序码
  1048: 'scan', // 长按图片识别小程序码
  1049: 'scan', // 手机相册小程序码
  1052: 'ad', // 卡券的适用门店列表
  1053: 'search', // 搜一搜的结果页
  1054: 'search', // 顶部搜索框小程序快捷入口
  1056: 'direct', // 音乐播放器菜单
  1057: 'ad', // 钱包中的银行卡详情页
  1058: 'mp_link', // 公众号文章
  1059: 'mp_link', // 体验版小程序绑定邀请页
  1064: 'direct', // 微信首页顶部搜索框「使用过的小程序」
  1067: 'ad', // 公众号文章广告
  1069: 'app', // 移动应用
  1071: 'social', // 钱包中的银行卡列表页
  1072: 'ad', // 二维码收款页面
  1073: 'notification', // 客服消息列表下发的小程序消息卡片
  1074: 'mp_link', // 公众号会话下发的小程序消息卡片
  1077: 'social', // 摇周边
  1078: 'social', // 微信连 Wi-Fi 成功提示页
  1079: 'direct', // 微信游戏中心
  1081: 'social', // 客服消息下发文字链
  1082: 'social', // 公众号会话下发文字链
  1084: 'ad', // 朋友圈广告原生页
  1089: 'history', // 微信聊天主界面下拉「最近使用」
  1090: 'social', // 长按小程序右上角菜单唤出最近使用历史
  1091: 'mp_link', // 公众号文章商品卡片
  1092: 'notification', // 城市服务入口
  1095: 'ad', // 小程序广告组件
  1096: 'ad', // 聊天记录
  1097: 'notification', // 微信支付签约页
  1099: 'ad', // 页面内嵌插件
  1102: 'mp_link', // 公众号 profile 页服务预览
  1103: 'history', // 发现栏小程序主入口「我的小程序」
  1104: 'history', // 微信聊天主界面下拉「我的小程序」
  1106: 'direct', // 聊天主界面下拉，从顶部搜索结果页
  1107: 'social', // 订阅消息
  1113: 'notification', // 安卓手机负一屏
  1114: 'notification', // 安卓手机侧边栏
  1129: 'social', // 微信爬虫访问
  1131: 'social', // 浮窗
  1133: 'notification', // 硬件设备打开
  1135: 'notification', // 小程序资料页
  1146: 'search', // 地理位置信息打开出行类小程序
  1148: 'social', // 群工具打开
  1150: 'social', // 扫一扫商品条码
  1153: 'social', // 群待办
  1154: 'social', // 朋友圈内打开「单页模式」
  1155: 'social', // 「单页模式」打开小程序
  1158: 'social', // 群工具打开小程序
  1160: 'social', // 群待办列表
  1167: 'social', // H5 通过开放标签打开
  1169: 'social', // 发现栏小程序主入口「我的小程序」
  1171: 'search', // 微信运动
  1173: 'social', // 视频号商品详情页
  1175: 'social', // 视频号直播间
  1176: 'social', // 视频号直播间购物袋
  1177: 'social', // 视频号直播评论区
  1178: 'social', // 视频号主页服务菜单
  1179: 'social', // 视频号私信
  1181: 'social', // 视频号动态
  1191: 'social', // 视频号活动页
  1194: 'social', // URL Scheme
  1195: 'social', // 视频号主页商品 tab
  1196: 'social', // 视频号主页商品列表
  1197: 'social', // 视频号主页活动 tab
  1198: 'social', // 视频号主页活动列表
  1200: 'social', // 视频号广告
  1201: 'ad', // 视频号广告详情页
  1206: 'social', // 视频号小游戏
  1208: 'social', // 聊天工具
  1223: 'search', // 搜一搜服务列表
  1228: 'social', // 视频号原生广告组件
  1231: 'social', // 动态消息提醒入口
};
function wxChannel(scene: number): SceneChannel {
  const e = WX_EXACT[scene];
  if (e) return e;
  if (scene >= 1005 && scene <= 1006) return 'search';
  if (scene >= 1007 && scene <= 1008) return 'social';
  if (scene >= 1011 && scene <= 1013) return 'scan';
  if (scene >= 1045 && scene <= 1046) return 'ad';
  if (scene >= 1170 && scene <= 1200) return 'social';
  return 'other';
}

/** 支付宝：官方场景值表（基础库 1.10.0 起；scene 为字符串） */
const MY_EXACT: Record<string, SceneChannel> = {
  '1000': 'direct', // 首页 12 宫格及更多
  '1002': 'history', // 小程序收藏
  '1005': 'search', // 顶部搜索框的搜索结果页
  '1007': 'social', // 单人聊天会话中的小程序消息卡片
  '1011': 'scan', // 扫描二维码
  '1014': 'notification', // 小程序模版消息（服务提醒）
  '1020': 'mp_link', // 生活号 profile 页
  '1023': 'direct', // 系统桌面图标
  '1037': 'mp_link', // 小程序打开小程序
  '1038': 'mp_link', // 从另一个小程序返回
  '1090': 'history', // 长按右上角菜单唤出最近使用
  '1300': 'app', // 第三方 App 打开
};
function myChannel(scene: number | string): SceneChannel {
  const s = String(scene);
  const e = MY_EXACT[s];
  if (e) return e;
  // 1200–1209：支付宝各服务频道（城市服务、芝麻信用、车主服务……）
  if (/^120\d$/.test(s)) return 'direct';
  return 'other';
}

/**
 * 抖音系：6 位字符串，前 2 位是宿主（02 抖音 / 10 抖音极速版 / 01 今日头条 / 06 今日头条极速版），第 3 位是入口大类，后 3 位是具体入口。
 * 大类在抖音与头条两系里含义不同（抖音 6 = 运营位、7 = 电商；头条 5 = 推广、6 = 广告、7 = 消息触达），按宿主分开映射。
 * 官方表：https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/framework/scene-value
 */
function ttChannel(scene: number | string): SceneChannel {
  const s = String(scene).padStart(6, '0');
  if (!/^\d{6}$/.test(s)) return 'other';
  const host = s.slice(0, 2);
  const cat = s[2];
  const id = s.slice(3);
  const douyin = host === '02' || host === '10';
  const toutiao = host === '01' || host === '06';
  if (!douyin && !toutiao) return 'other';
  if (cat === '1') {
    if (id === '009' || id === '010') return 'mp_link'; // 小程序跳转 / 返回小程序
    if (s === '021002' || s === '101002' || s === '011007') return 'scan'; // 扫一扫
    if (s === '011004' || s === '061001' || s === '061004') return 'history'; // 最近使用
    return 'direct'; // 我的 / 收藏 / 桌面快捷方式 / 业务固定入口
  }
  if (cat === '2') return 'search';
  if (cat === '3') return 'content'; // 视频页 / 直播间 / 文章 / feed
  if (cat === '4') return 'social'; // 分享
  if (douyin) {
    if (cat === '5') return 'ad';
    if (cat === '6') return s === '026003' || s === '026004' || s === '026006' ? 'notification' : 'ad'; // 运营位置：push / 消息通知归触达，其余是运营位
    if (cat === '7') return 'content'; // 电商：橱窗 / 商品卡 / 直播间购物车
    return 'other';
  }
  if (cat === '5') return 'ad'; // 推广或其他
  if (cat === '6') return 'ad';
  if (cat === '7') return 'notification'; // 消息触达
  return 'other';
}

/** 未知平台（百度 / 快手 / QQ）没有映射，返回 other */
export function sceneChannel(platform: string, scene: number | string | undefined | null): SceneChannel {
  if (scene === undefined || scene === null || scene === '') return 'other';
  if (platform === 'mp_weixin') return wxChannel(typeof scene === 'number' ? scene : parseInt(String(scene), 10) || 0);
  if (platform === 'mp_alipay') return myChannel(scene);
  if (platform === 'mp_bytedance') return ttChannel(scene);
  return 'other';
}
