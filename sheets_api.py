import asyncio
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ShopAPIError(RuntimeError):
    pass


class ShopAPI:
    def __init__(self, url: str, secret: str, timeout: int = 20):
        self.url, self.secret, self.timeout = url, secret, timeout

    def _request_sync(self, action: str, **payload):
        body = json.dumps({"action": action, "secret": self.secret, **payload}).encode()
        request = Request(self.url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                result = json.loads(response.read().decode())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ShopAPIError(f"Could not reach the Google Sheets API: {error}") from error
        if not result.get("ok"):
            raise ShopAPIError(result.get("error", "Unknown Google Sheets API error"))
        return result.get("data")

    async def request(self, action: str, **payload):
        return await asyncio.to_thread(self._request_sync, action, **payload)

    async def list_inventory(self, member=""):
        return await self.request("list_inventory", member=member)

    async def get_card(self, card_id):
        return await self.request("get_card", card_id=card_id)

    async def set_card_photo(self, card_id, telegram_file_id):
        return await self.request("set_card_photo", card_id=card_id, telegram_file_id=telegram_file_id)

    async def hold_card(self, card_id, telegram_user_id):
        return await self.request("hold_card", card_id=card_id, telegram_user_id=telegram_user_id)

    async def list_holds(self, telegram_user_id):
        return await self.request("list_holds", telegram_user_id=telegram_user_id)

    async def release_holds(self, card_ids, telegram_user_id):
        return await self.request("release_holds", card_ids=card_ids, telegram_user_id=telegram_user_id)

    async def create_order(self, **order):
        return await self.request("create_order", **order)

    async def list_orders(self, telegram_user_id):
        return await self.request("list_orders", telegram_user_id=telegram_user_id)

    async def cancel_order(self, order_id, telegram_user_id):
        return await self.request("cancel_order", order_id=order_id, telegram_user_id=telegram_user_id)

    async def add_claim_item(self, **claim):
        return await self.request("add_claim_item", **claim)

    async def remove_claim_item(self, claim_id, card_id, telegram_user_id):
        return await self.request(
            "remove_claim_item", claim_id=claim_id, card_id=card_id,
            telegram_user_id=telegram_user_id,
        )

    async def list_claims(self, telegram_user_id):
        return await self.request("list_claims", telegram_user_id=telegram_user_id)

    async def list_sets(self):
        return await self.request("list_sets")

    async def allocate_set(self, set_id):
        return await self.request("allocate_set", set_id=set_id)

    async def allocation_preview(self, set_id, telegram_user_id):
        return await self.request("allocation_preview", set_id=set_id, telegram_user_id=telegram_user_id)

    async def create_allocation_order(self, **order):
        return await self.request("create_allocation_order", **order)
