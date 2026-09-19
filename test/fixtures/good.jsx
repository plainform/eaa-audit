export function Checkout({ onSubmit, t, items }) {
  return (
    <main>
      <h1>Pagamento</h1>
      <h2>Indirizzo</h2>
      <img src="/logo.png" alt="Logo Acme" />
      <img src="/deco.png" alt="" />
      <svg role="img" aria-label="Carrello"><path d="M0 0" /></svg>
      <button onClick={onSubmit}>Conferma</button>
      <button onClick={onSubmit} aria-label="Chiudi"><CloseIcon /></button>
      <button onClick={onSubmit}>{t('save')}</button>
      <a href="/faq">Domande frequenti</a>
      <label htmlFor="mail">Email</label>
      <input id="mail" type="email" name="email" autoComplete="email" />
      <label>
        Telefono
        <input type="tel" name="tel" autoComplete="tel" />
      </label>
      <input type="hidden" name="token" />
      <input type="submit" value="Invia" />
      <div role="button" tabIndex={0} onClick={onSubmit} onKeyDown={onSubmit}>Alt</div>
      <span aria-hidden="true">★</span>
      <table>
        <tr><th scope="col">Articolo</th></tr>
        {items}
      </table>
      <video>
        <track kind="captions" src="/c.vtt" srcLang="it" label="Italiano" default />
      </video>
    </main>
  );
}
