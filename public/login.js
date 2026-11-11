const post = path => fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
document.querySelector('#logout')?.addEventListener('click', async () => { await post('/auth/logout'); location.reload(); });
document.querySelector('#delete-account')?.addEventListener('click', async () => {
  if (!confirm('Удалить аккаунт? Имя, аватар и все входы будут стёрты с сервера.')) return;
  await post('/auth/delete'); location.href = '/login';
});
