# Telegram Photocard Shop Bot

A starter Telegram shop bot for selling photocards.

## Included

- `/start` shop home
- Browse by ATEEZ member
- Demo photocard catalogue
- Add to cart
- Cart subtotal
- Delivery selection
- Checkout preview
- Railway deployment files
- Bot token kept outside the code

This version intentionally uses demo inventory stored in `bot.py`.
The next upgrade is Google Sheets integration.

## 1. Test locally

Install Python 3.11+.

Create a virtual environment:

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TELEGRAM_BOT_TOKEN="YOUR_TOKEN_HERE"
python bot.py
```

### Windows PowerShell

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:TELEGRAM_BOT_TOKEN="YOUR_TOKEN_HERE"
python bot.py
```

Then open your bot in Telegram and send:

```text
/start
```

## 2. Deploy on Railway

1. Put these project files in a GitHub repository.
2. In Railway, create a new project and choose **Deploy from GitHub repo**.
3. Select the repository.
4. In Railway, open the service → **Variables**.
5. Add:

```text
TELEGRAM_BOT_TOKEN = your BotFather token
```

6. Railway will install `requirements.txt` and run `python bot.py`.
7. Open Telegram and send `/start`.

## Important

Never upload your real Telegram bot token to GitHub or paste it inside `bot.py`.

If the token is ever exposed, use BotFather to revoke it and generate a new one.

## Next build stage

The planned Google Sheets connection will replace the demo `PRODUCTS` list and add:

- live inventory
- card images
- automatic card IDs
- reserved / sold status
- customer details
- order IDs
- PayNow instructions
- payment screenshot upload
- admin approval
- mailing status
- tracking numbers
- order history
- sales dashboard integration
