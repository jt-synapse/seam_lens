import ActionForm from '../ActionForm';
import { loginAction } from '../actions';

export const metadata = {title:'Curator sign in'};
export default function LoginPage() {
  return <main className="admin-login"><span className="admin-brand">SeamLens <i>Studio</i></span>
    <div className="admin-panel"><h1>Curator sign in</h1>
    <ActionForm action={loginAction}><label>Email address<input name="email" type="email" autoComplete="username" required/></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
      <button type="submit">Sign in</button></ActionForm></div></main>;
}
