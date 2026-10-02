import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  title: "oh-awesome-novel",
  description: "oh-awesome-novel 中文使用文档：从创建小说工作区到写作、审阅修改和保存历史。",
  srcExclude: ["README.md"],
  themeConfig: {
    nav: [
      { text: "使用指南", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "常见问题", link: "/guide/faq" },
      { text: "文档维护", link: "/maintenance" },
    ],
    sidebar: [
      {
        text: "开始使用",
        items: [
          { text: "文档介绍", link: "/" },
          { text: "安装与启动", link: "/guide/getting-started" },
          { text: "模型与偏好设置", link: "/guide/settings" },
          { text: "认识工作区", link: "/guide/workspace" },
        ],
      },
      {
        text: "日常创作",
        items: [
          { text: "章节与 AI 写作", link: "/guide/writing" },
          { text: "审阅与接受修改", link: "/guide/review" },
          { text: "搜索与导出正文", link: "/guide/search-and-export" },
          { text: "参考资料", link: "/guide/references" },
          { text: "剧情排演", link: "/guide/play" },
          { text: "Git 历史与同步", link: "/guide/git" },
        ],
      },
      {
        text: "帮助",
        items: [
          { text: "常见问题", link: "/guide/faq" },
          { text: "上下文与用量", link: "/guide/usage" },
          { text: "文档维护", link: "/maintenance" },
          { text: "界面截图", link: "/screenshots" },
        ],
      },
    ],
    search: {
      provider: "local",
      options: {
        miniSearch: {
          options: {
            // 中文按词索引，确保“审批”也能匹配“待审批修改”。
            tokenize: (text) =>
              Array.from(
                new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(text),
              )
                .filter((part) => part.isWordLike)
                .map((part) => part.segment),
          },
        },
        translations: {
          button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
          modal: {
            displayDetails: "显示详细列表",
            resetButtonTitle: "清除搜索",
            backButtonTitle: "关闭搜索",
            noResultsText: "没有找到相关内容",
            footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
          },
        },
      },
    },
    outline: { label: "本页目录", level: [2, 3] },
    docFooter: { prev: "上一篇", next: "下一篇" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "目录",
    darkModeSwitchLabel: "外观",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
    skipToContentLabel: "跳转到内容",
    notFound: {
      title: "页面未找到",
      quote: "可以通过左侧目录或搜索查找需要的使用说明。",
      linkLabel: "返回文档首页",
      linkText: "返回文档首页",
    },
  },
});
