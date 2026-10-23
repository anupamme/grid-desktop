#!/usr/bin/env python3
import json
import imaplib
import ssl
import sys
import socket
from concurrent.futures import ThreadPoolExecutor
import gi

gi.require_version('Goa', '1.0')
from gi.repository import Goa

TIMEOUT_SECONDS = 5

def _quick_close(client):
    try:
        if client.sock:
            client.sock.shutdown(socket.SHUT_RDWR)
            client.sock.close()
    except Exception:
        pass

def connect_imap(host, port, use_ssl):
    if use_ssl:
        ctx = ssl.create_default_context()
        return imaplib.IMAP4_SSL(host, port, ssl_context=ctx, timeout=TIMEOUT_SECONDS)
    client = imaplib.IMAP4(host, port, timeout=TIMEOUT_SECONDS)
    try:
        ctx = ssl.create_default_context()
        client.starttls(ssl_context=ctx)
    except Exception:
        pass
    return client

def fetch_unseen_with_password(host, port, use_ssl, user, password):
    client = None
    try:
        client = connect_imap(host, port, use_ssl)
        client.login(user, password)
        status, response = client.status('INBOX', '(UNSEEN)')
        if status == 'OK':
            parts = response[0].decode('utf-8').split('UNSEEN')
            if len(parts) > 1:
                return int(parts[1].strip().split(')')[0])
    except Exception as e:
        sys.stderr.write(f"IMAP hiba ({user}@{host}): {e}\n")
    finally:
        if client:
            _quick_close(client)
    return 0

def fetch_unseen_with_xoauth2(host, port, use_ssl, user, access_token):
    client = None
    try:
        client = connect_imap(host, port, use_ssl)
        auth_str = f"user={user}\1auth=Bearer {access_token}\1\1"
        client.authenticate('XOAUTH2', lambda x: auth_str.encode('utf-8'))
        status, response = client.status('INBOX', '(UNSEEN)')
        if status == 'OK':
            parts = response[0].decode('utf-8').split('UNSEEN')
            if len(parts) > 1:
                return int(parts[1].strip().split(')')[0])
    except Exception as e:
        sys.stderr.write(f"XOAUTH2 hiba ({user}@{host}): {e}\n")
    finally:
        if client:
            _quick_close(client)
    return 0

def process_account(acc):
    account = acc.get_account()
    if not account or account.props.mail_disabled:
        return None

    user_id = account.props.presentation_identity
    provider = account.props.provider_type
    oauth2 = acc.get_oauth2_based()
    passwd_based = acc.get_password_based()
    mail_props = acc.get_mail()

    unread = 0

    # 1. Google fiók
    if provider == 'google' and oauth2:
        try:
            token = oauth2.call_get_access_token_sync(None)[0]
            unread = fetch_unseen_with_xoauth2('imap.gmail.com', 993, True, user_id, token)
        except Exception as e:
            sys.stderr.write(f"Google token hiba ({user_id}): {e}\n")

    # 2. Szabványos IMAP fiók
    elif mail_props:
        imap_host = mail_props.props.imap_host
        imap_user = mail_props.props.imap_user_name or user_id
        use_ssl = mail_props.props.imap_use_ssl
        imap_port = 993 if use_ssl else 143

        if passwd_based:
            try:
                password = passwd_based.call_get_password_sync('imap-password', None)
                if password and imap_host:
                    unread = fetch_unseen_with_password(imap_host, imap_port, use_ssl, imap_user, password)
            except Exception as e:
                sys.stderr.write(f"Jelszó lekérési hiba ({user_id}): {e}\n")

    return {
        "id": account.props.id,
        "name": user_id,
        "unread": unread
    }

def main():
    socket.setdefaulttimeout(TIMEOUT_SECONDS)
    results = []
    total = 0

    try:
        client = Goa.Client.new_sync(None)
        accounts = client.get_accounts()

        # Párhuzamos lekérdezés szálakkal
        with ThreadPoolExecutor(max_workers=4) as executor:
            fetched_results = list(executor.map(process_account, accounts))

        for item in fetched_results:
            if item:
                results.append(item)
                total += item["unread"]

    except Exception as err:
        sys.stderr.write(f"Fő hiba: {err}\n")

    print(json.dumps({"unreadTotal": total, "accounts": results}))

if __name__ == '__main__':
    main()