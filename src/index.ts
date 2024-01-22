import { assert } from "chai";
import { ethers } from "ethers";

import * as dotenv from "dotenv";
import * as http from 'http'
import * as path from 'path';

import { Chain, Common, Hardfork } from '@ethereumjs/common'
import { BlobEIP4844Transaction } from '@ethereumjs/tx'

import pkg from 'c-kzg';
import axios from 'axios';

const {
    blobToKzgCommitment,
    computeBlobKzgProof,
    verifyBlobKzgProof,
    loadTrustedSetup
  } = pkg;

const common = new Common({ chain: Chain.Goerli, hardfork: Hardfork.Cancun, eips: [4844] })

dotenv.config();

assert(process.env.OWNER_PK !== undefined);
assert(process.env.RPC_URL !== undefined);

const ownerPrivateKey = process.env.OWNER_PK;
const rpcUrl = process.env.RPC_URL;

// Setup provider, wallet
const provider: ethers.providers.JsonRpcProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
const signer: ethers.Wallet = new ethers.Wallet(ownerPrivateKey, provider);

async function sendRawTransaction() {
    const from: string = await signer.getAddress();
    const to: string = await ethers.Wallet.createRandom().getAddress();
    const nonce: number = await provider.getTransactionCount(from, 'pending');
    const chainId: number = await signer.getChainId();
    const feeData: ethers.providers.FeeData = await provider.getFeeData();
    // console.log(feeData)

    const BYTES_PER_BLOB = 4096 * 32
    const dummyBlob = Buffer.alloc(BYTES_PER_BLOB, "*")

    loadTrustedSetup(path.resolve("src/trusted_setup.txt"))
    const commitment = blobToKzgCommitment(dummyBlob);
    const proof = computeBlobKzgProof(dummyBlob, commitment);
    const isValid = verifyBlobKzgProof(dummyBlob, commitment, proof)

    // console.log(isValid)
    // console.log( "0x01" + ethers.utils.sha256(commitment).substr(4, 64)) // versioned hash
    
    const txData = {
        chainId: ethers.utils.hexlify(chainId),
        nonce: ethers.utils.hexlify(nonce),
        // nonce: ethers.utils.hexlify(nonce),
        maxPriorityFeePerGas: ethers.utils.hexlify(feeData.maxPriorityFeePerGas),
        maxFeePerGas: ethers.utils.hexlify(feeData.maxFeePerGas),
        maxFeePerBlobGas: '0xffff',
        gasLimit: "0x989680", // 10 million
        to,
        value: "0x00",
        data: "0x",
        type: '0x03',
        accessList: [],
        // maxFeePerBlobGas: ethers.utils.arrayify(ethers.utils.hexlify(159000000000)),
        blobVersionedHashes: ["0x01" + ethers.utils.sha256(commitment).substr(4, 64)],
        kzgCommitments: [ethers.utils.hexlify(commitment)],
        blobs: [dummyBlob],
        kzgProofs: [ethers.utils.hexlify(proof)]
    };

    const tx = BlobEIP4844Transaction.fromTxData(txData, { common })    
    const signedTx = tx.sign(Buffer.from(ownerPrivateKey, 'hex'))

    console.log(signedTx.serializeNetworkWrapper())

    const rawTx = ethers.utils.hexlify(signedTx.serializeNetworkWrapper())
    const data = JSON.stringify(
        { "jsonrpc": "2.0", "method": "eth_sendRawTransaction", "params": [rawTx], "id": 1 }
    )
    
    const res = await axios({
        method: 'post',
        url: process.env.RPC_URL,
        data
    })

    return res;
}

sendRawTransaction()
    .then(res => console.log(res))
    .catch(error => console.error(error));
