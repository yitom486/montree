/** PDF 字形编码泄漏到文字层时，页面可正常绘制，提取的文本却无法直接阅读。 */
export function hasUnreadableText(text: string): boolean {
  // 保留正常空白、连字、数学符号和 Emoji；不把合法的方框/复选框当成乱码。
  return /[\uFFFD\uFFFE\uFFFF\u0000-\u0008\u000B\u000E-\u001F\u007F-\u0084\u0086-\u009F\p{Co}\p{Cs}]/u.test(text)
}
