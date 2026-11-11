import { headMarkup, footerMarkup } from '../site.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const providerName = {discord: 'Discord', telegram: 'Telegram'};

export function loginPage({me, discordOn, telegramOn, botName, ret, origin}) {
  let body;
  if (me) {
    body = `<div class="account-card">${me.avatar ? `<img class="avatar-img large" src="${esc(me.avatar)}" alt="">` : `<span class="avatar large">${esc(me.displayName[0])}</span>`}<div><strong>${esc(me.displayName)}</strong>${me.username ? `<div class="subtle">@${esc(me.username)}</div>` : ''}<div class="subtle">Вход через ${providerName[me.provider]}</div></div></div>
<p>В комнате нажмите «Добавить себя» — имя и аватар подставятся сами. Остальных людей за этим компьютером добавляйте как гостей.</p>
<div class="row wrap"><a class="button" href="${esc(ret)}">Играть</a><button class="secondary" id="logout">Выйти из аккаунта</button></div>
<div class="divider"></div>
<p class="subtle">Удаление стирает аккаунт и все сессии на сервере без возможности восстановления.</p>
<button class="danger" id="delete-account">Удалить аккаунт</button>`;
  } else {
    const options = [
      discordOn ? `<a class="button discord" href="/auth/discord?return=${encodeURIComponent(ret)}">Войти через Discord</a>` : '',
      telegramOn ? `<div class="telegram-login"><script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${esc(botName)}" data-size="large" data-radius="10" data-auth-url="${esc(origin)}/auth/telegram/callback"></script></div>` : '',
    ].filter(Boolean);
    body = `<p>Войдите, чтобы в комнатах сразу появлялись ваше имя, @ник и аватар. Мы берём только это: без телефона, почты и доступа к сообщениям.</p>
${options.length ? `<div class="stack login-options">${options.join('')}</div>` : '<div class="rule">Вход через аккаунт пока не настроен. Играйте как гость.</div>'}
<div class="divider"></div>
<p>Можно и без аккаунта: <a href="${esc(ret)}">играть как гость</a> — достаточно ввести имя в комнате.</p>`;
  }
  return `<!doctype html><html lang="ru"><head>${headMarkup({title: 'Вход — Скажи иначе', path: '/login'})}<meta name="robots" content="noindex"></head><body><header><a href="/" class="logo">скажи<span>иначе.</span></a><span class="tag">Игра, которая сближает</span><a id="connection" href="/">Играть</a></header><main class="page"><article class="panel prose"><h1>${me ? 'Ваш аккаунт' : 'Вход'}</h1>${body}</article></main>${footerMarkup()}<script type="module" src="/login.js"></script></body></html>`;
}
