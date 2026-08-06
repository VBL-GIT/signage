import './config/env'; // validate env first
import app from './app';
import { env } from './config/env';

const port = parseInt(env.PORT, 10);

app.listen(port, () => {
  console.log(`Signage API running on port ${port}`);
});
