# Logo Assets — pi2pi

## Расположение файлов

```
arc/assets/logos/
├── metamask.svg        ← скачать: https://metamask.io/press-kit/
├── circle.svg          ← скачать: https://www.circle.com/en/brand
└── walletconnect.svg   ← скачать: https://walletconnect.com/brand
```

Сервер `server-arc.js` отдаёт статику из `arc/` как web root.
Файлы доступны по URL: `/assets/logos/metamask.svg` и т.д.

---

## Как использовать в JSX

### Базовый вариант (на тёмном фоне)

```jsx
<img
  src="/assets/logos/metamask.svg"
  width="30"
  height="30"
  alt="MetaMask"
  style={{ display: 'block' }}
/>

<img
  src="/assets/logos/circle.svg"
  width="30"
  height="30"
  alt="Circle"
  style={{ display: 'block' }}
/>
```

### В кнопке подключения кошелька

```jsx
<button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
  <img src="/assets/logos/metamask.svg" width="24" height="24" alt="" aria-hidden="true" />
  Sign with MetaMask
</button>
```

### Логотип + название рядом

```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <img src="/assets/logos/circle.svg" width="20" height="20" alt="Circle" />
  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-dim)' }}>
    Powered by Circle
  </span>
</div>
```

---

## Правила использования на тёмном фоне

Фон страницы в dark теме: `#05070D` / `#0A0F1C`
Фон карточки: `#0F1629`

### MetaMask (лиса — многоцветный SVG)
- Цвета встроены в файл, CSS не перекрашивает
- Работает на тёмном фоне без изменений
- Не добавляй `filter` или `background` вокруг логотипа
- Рекомендуемый размер: 24–32px

### Circle (одноцветный или двухцветный SVG)
- Если SVG использует `currentColor` → можно красить через CSS:
  ```jsx
  <img src="/assets/logos/circle.svg" style={{ filter: 'brightness(0) invert(1)' }} width="24" height="24" />
  ```
  Это делает логотип белым — подходит для тёмного фона.
- Если цвета встроены → оставь как есть, проверь на тёмном фоне визуально.

### WalletConnect (синий логотип)
- На тёмном фоне выглядит хорошо без изменений
- Рекомендуемый размер: 24–28px

---

## Размеры по контексту

| Контекст | Размер |
|---|---|
| Кнопка подключения | 24×24px |
| Список методов оплаты | 28×28px |
| Страница настроек кошелька | 32×32px |
| Онбординг / выбор кошелька | 40×40px |

---

## Что НЕ делать

```jsx
// ❌ Не масштабируй через CSS width без явного height — SVG растянется
<img src="/assets/logos/metamask.svg" style={{ width: '100%' }} />

// ❌ Не вставляй PNG версии — пикселятся на retina
<img src="/assets/logos/metamask.png" />

// ❌ Не хардкодь inline SVG код логотипов — тяжело поддерживать
<svg>...500 строк кода MetaMask лисы...</svg>

// ✅ Правильно — всегда через <img> с явными width и height
<img src="/assets/logos/metamask.svg" width="28" height="28" alt="MetaMask" />
```

---

## Placeholder пока файлов нет

Если SVG файлы ещё не скачаны, используй временный placeholder:

```jsx
const LogoPlaceholder = ({ name, size = 28 }) => (
  <div style={{
    width: size, height: size,
    borderRadius: 6,
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-mono)', fontSize: 8,
    color: 'var(--color-text-dim)'
  }}>
    {name[0]}
  </div>
);

// Использование:
<LogoPlaceholder name="MetaMask" size={28} />
<LogoPlaceholder name="Circle" size={28} />
```

Заменяется на `<img>` после того как SVG файлы лягут в `arc/assets/logos/`.
