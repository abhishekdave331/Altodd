import express from 'express';
import { dashboardRoutes } from './routes/dashboardRoutes.js';

const app = express();

app.use(express.json());

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.use('/api/dashboard', dashboardRoutes);

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 3003);
app.listen(port, () => {
    console.log(`market-intelligence API listening on port ${port}`);
});
