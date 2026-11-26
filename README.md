# dsh-window-shake

一个独立的轻量 DSH 客户端插件，在桌面端以约 20 Hz 采样 `window.screenX`。当 1.2 秒内出现至少 3 次方向反转且累计水平位移达到 150px 时，执行冷却并向全局派发 `dsh:window-shake` 自定义事件，供海景背景或状态词轮换等插件各自独立订阅。

此包是 [`dsh-pirate-mode`](https://github.com/butterfly301/dsh-pirate-mode) 的组件，也可以单独安装使用。

开启系统「减少动态效果」时彻底禁用，不注册采样器。

## 独立安装与配置

```bash
dsh plugin --profile desktop add dsh-window-shake
```

可在 `cordis.patch.yml` 中配置启用状态与冷却时间：

```yaml
- insert:
    - id: dsh-window-shake
      name: 'dsh-window-shake'
      config:
        enabled: true
        cooldownMs: 60000
```

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 是否开启窗口摇晃采样 |
| `cooldownMs` | `number` | `60000` | 触发后的最小冷却毫秒数，最小 `1000` |

## 事件契约

触发时在 `window` 上派发 `dsh:window-shake` 自定义事件，`event.detail` 包含 `{ at, intensity, durationMs, reversals, displacementPx }`。

## 许可

MIT
