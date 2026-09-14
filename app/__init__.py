import os
from flask import Flask
from .storage import *

def create_app():
    app = Flask(__name__)

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app.config["DB_FILE"] = os.environ.get(
        "DB_FILE", os.path.join(base_dir, "data", "myinfra.db")
    )
    app.config["UPLOAD_FOLDER"] = os.path.join(app.static_folder, "uploads")
    app.config["MAX_CONTENT_LENGTH"] = 5242880 # 5 MB

    os.makedirs(os.path.dirname(app.config["DB_FILE"]), exist_ok=True)
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    init_db(app.config["DB_FILE"])

    from .routes import bp as main_bp
    app.register_blueprint(main_bp)

    app.teardown_appcontext(close_db)

    return app
