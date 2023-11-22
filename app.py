import hivemind
from flask import Flask
from flask_cors import CORS
from flask_sock import Sock

import utils
import views

logger = hivemind.get_logger(__file__)

logger.info("Loading models")
models = utils.load_models()

logger.info("Starting Flask app")
app = Flask(__name__)
CORS(app)
app.config["SOCK_SERVER_OPTIONS"] = {"ping_interval": 25}
sock = Sock(app)

logger.info("Pre-rendering index4 page")
index_html4 = views.render_index4(app)

@app.route("/")
def main_page4():
    return index_html4

import http_api
import websocket_api
