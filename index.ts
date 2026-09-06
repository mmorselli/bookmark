import { registerRootComponent } from 'expo';
import App from './src/App';
import { installDiagnostics } from './src/platform/diagnostics';

installDiagnostics();
registerRootComponent(App);
